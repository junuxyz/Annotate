import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  dataSchema,
  emptyData,
  locateAnchor,
  makeAnchor,
  mapAnchor,
  renameThreads,
  type Thread,
} from '../src/model';

test('inserting before a selection keeps the comment on its text', () => {
  const state = EditorState.create({ doc: 'hello selected end' });
  const tr = state.update({ changes: { from: 0, insert: 'new ' } });
  const anchor = mapAnchor(
    makeAnchor(state.doc.toString(), 6, 14),
    tr.changes,
    tr.newDoc.toString(),
  );
  assert.equal(anchor.from, 10);
  assert.equal(anchor.quote, 'selected');
});
test('typing at the selection boundaries is excluded', () => {
  const state = EditorState.create({ doc: 'abc' });
  const tr = state.update({
    changes: [
      { from: 0, insert: '(' },
      { from: 3, insert: ')' },
    ],
  });
  const anchor = mapAnchor(makeAnchor('abc', 0, 3), tr.changes, tr.newDoc.toString());
  assert.equal(anchor.quote, 'abc');
  assert.equal(anchor.from, 1);
  assert.equal(anchor.to, 4);
});
test('edits inside a selection update its stored quote', () => {
  const state = EditorState.create({ doc: 'the cat sleeps' });
  const tr = state.update({ changes: { from: 5, to: 6, insert: 'o' } });
  assert.equal(
    mapAnchor(makeAnchor(state.doc.toString(), 4, 7), tr.changes, tr.newDoc.toString()).quote,
    'cot',
  );
});
test('deleting selected text preserves an orphaned anchor', () => {
  const state = EditorState.create({ doc: 'before target after' });
  const tr = state.update({ changes: { from: 7, to: 13 } });
  const anchor = mapAnchor(
    makeAnchor(state.doc.toString(), 7, 13),
    tr.changes,
    tr.newDoc.toString(),
  );
  assert.equal(anchor.orphaned, true);
  assert.equal(anchor.quote, 'target');
  assert.equal(locateAnchor(anchor, 'target elsewhere').orphaned, true);
});
test('reopening a note relocates a unique quote after external edits', () => {
  const anchor = makeAnchor('before target after', 7, 13);
  assert.equal(locateAnchor(anchor, 'added before target after').from, 13);
});
test('context disambiguates repeated passages', () => {
  const original = 'first target one / second target two';
  const anchor = makeAnchor(original, 26, 32);
  assert.equal(anchor.quote, 'target');
  const relocated = locateAnchor(anchor, 'intro ' + original);
  assert.equal(relocated.from, 32);
  assert.equal(relocated.orphaned, false);
});
test('ambiguous repeated text is never silently attached elsewhere', () => {
  const anchor = makeAnchor('target', 0, 6);
  assert.equal(locateAnchor(anchor, 'target target').orphaned, true);
});
test('file and folder renames preserve threads without matching sibling names', () => {
  const thread = (path: string): Thread => ({
    id: path,
    path,
    anchor: makeAnchor('x', 0, 1),
    resolved: false,
    comments: [{ id: 'c', author: 'You', body: 'hello', createdAt: 0 }],
  });
  const threads = [thread('folder/note.md'), thread('folderish/note.md')];
  renameThreads(threads, 'folder', 'renamed');
  assert.deepEqual(
    threads.map((t) => t.path),
    ['renamed/note.md', 'folderish/note.md'],
  );
  renameThreads(threads, 'renamed/note.md', 'renamed/new.md');
  assert.equal(threads[0]?.path, 'renamed/new.md');
});
test('persistent data rejects malformed or unsupported versions', () => {
  assert.equal(dataSchema.safeParse(emptyData()).success, true);
  assert.equal(dataSchema.safeParse({ ...emptyData(), version: 2 }).success, false);
  assert.equal(
    dataSchema.safeParse({ ...emptyData(), threads: [{ anchor: { from: 4, to: 2 } }] }).success,
    false,
  );
});
test('multiline and Korean selections use editor UTF-16 offsets', () => {
  const text = 'Intro\n메모 😀\nlast';
  const from = text.indexOf('메모'),
    to = text.indexOf('\nlast');
  const anchor = makeAnchor(text, from, to);
  assert.equal(locateAnchor(anchor, 'start ' + text).quote, '메모 😀');
});

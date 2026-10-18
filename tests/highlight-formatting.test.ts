import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState } from '@codemirror/state';
import { highlightFormatting } from '../src/highlight-formatting';
import { highlightChanges, highlightEdit, textColorEdit, textColors } from '../src/highlight';
import { makeAnchor, mapAnchor } from '../src/model';

const text = '터널 시각';
const yellow = { id: 'yellow', name: 'Yellow', value: '#ffe06680' };
function paint(state: EditorState, tag: 'mark' | 'span') {
  const source = state.doc.toString();
  const from = source.indexOf(text);
  const edit =
    tag === 'mark'
      ? highlightEdit(source, from, from + text.length, yellow, 'rounded')
      : textColorEdit(source, from, from + text.length, textColors[1]);
  assert.ok(edit);
  const transaction = state.update({
    changes: highlightChanges(source, edit, tag),
    selection: { anchor: edit.selectionFrom, head: edit.selectionTo },
  });
  assert.equal(
    transaction.newDoc.toString(),
    source.slice(0, edit.from) + edit.insert + source.slice(edit.to),
    'palette edits already have canonical tags and keep their explicit selection offsets',
  );
  return transaction.state;
}
function emphasize(state: EditorState, selected: string, delimiter: string) {
  const from = state.doc.toString().indexOf(selected),
    to = from + selected.length;
  return state.update({
    changes: [
      { from, insert: delimiter },
      { from: to, insert: delimiter },
    ],
    selection: { anchor: to + delimiter.length, head: from + delimiter.length },
    userEvent: 'input',
  });
}
for (const tag of ['mark', 'span'] as const) {
  void test(`${tag}: partial bold splits tags, maps comments and selection, and undoes atomically`, () => {
    const initial = EditorState.create({ doc: `앞 ${text} 뒤`, extensions: highlightFormatting });
    const state = paint(initial, tag);
    const source = state.doc.toString();
    const from = source.indexOf(text);
    const anchor = makeAnchor(source, from, from + text.length);
    const transaction = emphasize(state, '시각', '**');
    const result = transaction.newDoc.toString();
    assert.match(result, new RegExp(`터널 </${tag}>\\*\\*<${tag}[^>]*>시각</${tag}>\\*\\*`));
    assert.equal(
      transaction.state.sliceDoc(
        transaction.newSelection.main.from,
        transaction.newSelection.main.to,
      ),
      '시각',
    );
    assert.ok(transaction.newSelection.main.anchor > transaction.newSelection.main.head);
    const mapped = mapAnchor(anchor, transaction.changes, result);
    assert.equal(mapped.orphaned, false);
    assert.equal(mapped.quote.replace(/<[^>]+>|\*\*/g, ''), text);
    const restored = transaction.state.update({
      changes: transaction.changes.invert(state.doc),
      filter: false,
    });
    assert.equal(restored.newDoc.toString(), source);
    assert.equal(
      restored.state.update({ changes: transaction.changes, filter: false }).newDoc.toString(),
      result,
    );
  });
  void test(`${tag}: removing bold clears derived styling and retains color`, () => {
    let state = EditorState.create({ doc: `앞 **${text}** 뒤`, extensions: highlightFormatting });
    state = paint(state, tag);
    const source = state.doc.toString(),
      start = source.indexOf('**'),
      end = source.lastIndexOf('**');
    const transaction = state.update({
      changes: [
        { from: start, to: start + 2 },
        { from: end, to: end + 2 },
      ],
    });
    const result = transaction.newDoc.toString();
    assert.ok(!result.includes('font-weight'));
    assert.ok(result.includes(tag === 'mark' ? 'background:' : 'color:'));
    assert.equal(result.replace(/<[^>]+>/g, ''), `앞 ${text} 뒤`);
  });
  void test(`${tag}: bold around the entire wrapper also updates its widget styling`, () => {
    const state = paint(EditorState.create({ doc: text, extensions: highlightFormatting }), tag);
    const transaction = emphasize(state, state.doc.toString(), '**');
    assert.match(transaction.newDoc.toString(), /font-weight: var\(--bold-weight, 700\)/);
    assert.ok(transaction.newDoc.toString().startsWith(`**<${tag}`));
  });
}
void test('multiple selections format separate highlighted lines in one transaction', () => {
  let state = EditorState.create({ doc: text, extensions: highlightFormatting });
  state = paint(paint(state, 'mark'), 'span');
  const line = state.doc.toString();
  state = EditorState.create({
    doc: line + '\n' + line,
    extensions: [highlightFormatting, EditorState.allowMultipleSelections.of(true)],
  });
  const first = line.indexOf(text),
    second = first + line.length + 1;
  const transaction = state.update({
    changes: [first, second].flatMap((from) => [
      { from, insert: '**' },
      { from: from + text.length, insert: '**' },
    ]),
    selection: EditorSelection.create([
      EditorSelection.range(first + 2, first + 2 + text.length),
      EditorSelection.range(second + 6, second + 6 + text.length),
    ]),
  });
  for (const line of transaction.newDoc.toString().split('\n')) {
    assert.ok(line.startsWith('**<'), line);
    assert.ok(line.endsWith('>**'), line);
  }
  for (const range of transaction.newSelection.ranges)
    assert.equal(transaction.state.sliceDoc(range.from, range.to), text);
});
void test('code, foreign HTML, untouched lines and selection-only transactions are preserved', () => {
  const source =
    '`<mark data-annotate-highlight="yellow">**code**</mark>`\n<span class="foreign">**foreign**</span>\n<mark data-annotate-highlight="yellow">**legacy**</mark>\nedit here';
  const state = EditorState.create({ doc: source, extensions: highlightFormatting });
  assert.equal(state.update({ selection: { anchor: 5 } }).newDoc.toString(), source);
  assert.equal(
    state.update({ changes: { from: source.length, insert: '!' } }).newDoc.toString(),
    source + '!',
  );
  const code = source.indexOf('code');
  const foreign = source.indexOf('foreign**');
  const transaction = state.update({
    changes: [
      { from: code, insert: 'x' },
      { from: foreign, insert: 'y' },
    ],
  });
  assert.equal(
    transaction.newDoc.toString(),
    source.slice(0, code) + 'x' + source.slice(code, foreign) + 'y' + source.slice(foreign),
  );
});

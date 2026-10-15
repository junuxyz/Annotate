import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
const temp = await mkdtemp(join(tmpdir(), 'annotate-notes-'));
const require = createRequire(import.meta.url);
await esbuild.build({
  stdin: {
    contents: `export {FileSystemAdapter,TFile} from 'obsidian'; export * from '${process.cwd()}/src/note-tools.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(temp, 'bridge.cjs'),
  plugins: [
    {
      name: 'obsidian',
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: `export class FileSystemAdapter { constructor(base) { this.base=base; } getBasePath() { return this.base; } } export class TFile { constructor(path) { this.path=path; this.stat={size:0}; } }`,
        }));
      },
    },
  ],
});
const bridge = require(join(temp, 'bridge.cjs'));
const { normalizeNoteFolder } = bridge;
async function fixture(hooks = {}) {
  const base = await mkdtemp(join(temp, 'vault-'));
  await mkdir(join(base, 'Notes'));
  await mkdir(join(base, 'Other'));
  const notes = new Map([
    ['Notes/a.md', 'original'],
    ['Other/private.md', 'secret'],
  ]);
  const files = new Map([...notes.keys()].map((path) => [path, new bridge.TFile(path)]));
  const folders = new Map([
    ['Notes', { path: 'Notes' }],
    ['Other', { path: 'Other' }],
  ]);
  const trashed = [];
  let saved = [];
  let failSave = false;
  let failWrite = false;
  let approved = false;
  const allowed = ['Notes'];
  const vault = {
    configDir: '.obsidian',
    adapter: new bridge.FileSystemAdapter(base),
    getAbstractFileByPath: (path) => files.get(path) ?? folders.get(path) ?? null,
    getRoot: () => ({ path: '' }),
    getMarkdownFiles: () => [...files.values()],
    read: async (file) => notes.get(file.path),
    create: async (path, text) => {
      if (files.has(path)) throw Error('exists');
      files.set(path, new bridge.TFile(path));
      notes.set(path, text);
    },
    process: async (file, fn) => {
      if (failWrite) throw Error('write failed');
      await hooks.process?.();
      notes.set(file.path, fn(notes.get(file.path)));
    },
  };
  const tools = new bridge.NoteTools({
    vault,
    fileManager: {
      trashFile: async (file) => {
        trashed.push(file.path);
        files.delete(file.path);
        notes.delete(file.path);
      },
    },
    getFolders: () => allowed,
    getEditor: (path) => hooks.getEditor?.(path) ?? null,
    requestFolderAccess: async (folder, signal) => {
      await hooks.approve?.(folder, signal);
      signal?.throwIfAborted();
      if (approved) allowed.push(folder);
      return approved;
    },
    saveHistory: async (history) => {
      if (failSave) throw Error('backup failed');
      await hooks.save?.(history);
      saved = history;
    },
  });
  return {
    tools,
    notes,
    files,
    base,
    trashed,
    set failWrite(value) {
      failWrite = value;
    },
    vault,
    get saved() {
      return saved;
    },
    set failSave(value) {
      failSave = value;
    },
    set approved(value) {
      approved = value;
    },
  };
}
test('literal paths reject traversal, hidden folders, encoded and absolute paths', () => {
  for (const path of [
    '',
    '/',
    '../Notes',
    'Notes/../Other',
    'Notes//a',
    'Notes\\a',
    'Notes/%2e%2e',
    'Notes/.secret',
    '.obsidian',
    'C:/Notes',
    'Notes/a.',
  ])
    assert.throws(() => normalizeNoteFolder(path), path);
  assert.equal(normalizeNoteFolder('Notes/Research'), 'Notes/Research');
});
test('reads and searches stay within explicit folders and Markdown files', async () => {
  const f = await fixture();
  assert.deepEqual(await f.tools.execute('search_notes', { query: 'secret' }, 'one'), {
    paths: [],
  });
  assert.equal(
    (await f.tools.execute('read_note', { path: 'Notes/a.md' }, 'one')).content,
    'original',
  );
  for (const path of ['Other/private.md', 'Notes/.env.md', 'Notes/file.txt'])
    await assert.rejects(f.tools.assertAllowed(path));
});
test('specific folder access requires approval and rejects hidden grants', async () => {
  const f = await fixture();
  assert.equal(
    (await f.tools.execute('request_note_folder', { folder: 'Other' }, 'one')).approved,
    false,
  );
  await assert.rejects(f.tools.assertAllowed('Other/private.md'));
  f.approved = true;
  assert.equal(
    (await f.tools.execute('request_note_folder', { folder: 'Other' }, 'one')).approved,
    true,
  );
  await f.tools.assertAllowed('Other/private.md');
  await assert.rejects(f.tools.execute('request_note_folder', { folder: '.obsidian' }, 'one'));
});
test('symlinked folders and files are blocked before content is read', async () => {
  const f = await fixture();
  await symlink(join(f.base, 'Other'), join(f.base, 'Notes', 'linked'));
  await assert.rejects(f.tools.assertAllowed('Notes/linked/private.md'), /Symbolic/);
});
test('snapshot failure prevents writes and conflict snapshots are preserved', async () => {
  const f = await fixture();
  f.failSave = true;
  await assert.rejects(
    f.tools.execute(
      'edit_note',
      { path: 'Notes/a.md', content: 'new', expectedContent: 'original' },
      'one',
    ),
    /backup/,
  );
  assert.equal(f.notes.get('Notes/a.md'), 'original');
  f.failSave = false;
  await f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'new', expectedContent: 'original' },
    'one',
  );
  f.notes.set('Notes/a.md', 'external edit');
  await assert.rejects(f.tools.undo('one'), /changed/);
  assert.equal(f.notes.get('Notes/a.md'), 'external edit');
  assert.equal(f.saved[0].changes[0].before, 'original');
});
test('grouped edits, creations and trash deletes undo as one operation', async () => {
  const f = await fixture();
  await f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'new', expectedContent: 'original' },
    'one',
  );
  await f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'newer', expectedContent: 'new' },
    'one',
  );
  await f.tools.execute('create_note', { path: 'Notes/b.md', content: 'created' }, 'one');
  await f.tools.execute('delete_note', { path: 'Notes/a.md', expectedContent: 'newer' }, 'one');
  assert.deepEqual(f.trashed, ['Notes/a.md']);
  await f.tools.undo('one');
  assert.equal(f.notes.get('Notes/a.md'), 'original');
  assert.equal(f.notes.has('Notes/b.md'), false);
  assert.equal(f.tools.history[0].status, 'undone');
});
test('undo preflight prevents partial restore if any note changed', async () => {
  const f = await fixture();
  await f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'new', expectedContent: 'original' },
    'one',
  );
  await f.tools.execute('create_note', { path: 'Notes/b.md', content: 'created' }, 'one');
  f.notes.set('Notes/b.md', 'external');
  await assert.rejects(f.tools.undo('one'), /changed/);
  assert.equal(f.notes.get('Notes/a.md'), 'new');
});
test('a failed repeated edit preserves the intermediate state needed for recovery', async () => {
  const f = await fixture();
  await f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'new', expectedContent: 'original' },
    'one',
  );
  f.failWrite = true;
  await assert.rejects(
    f.tools.execute(
      'edit_note',
      { path: 'Notes/a.md', content: 'newer', expectedContent: 'new' },
      'one',
    ),
    /write failed/,
  );
  assert.equal(f.tools.history[0].status, 'pending');
  f.failWrite = false;
  await f.tools.undo('one');
  assert.equal(f.notes.get('Notes/a.md'), 'original');
});
test('unknown adapters, custom configuration folders and oversized notes fail closed', async () => {
  const f = await fixture();
  f.vault.configDir = 'Notes';
  await assert.rejects(f.tools.assertAllowed('Notes/a.md'), /configuration/);
  f.vault.configDir = '.obsidian';
  f.vault.adapter = {};
  await assert.rejects(f.tools.assertAllowed('Notes/a.md'), /filesystem/);
  await assert.rejects(
    f.tools.execute('create_note', { path: 'Notes/b.md', content: 'x'.repeat(1_000_001) }, 'one'),
  );
  assert.equal(f.notes.has('Notes/b.md'), false);
});
test('an explicit vault-root grant permits root notes and still blocks protected paths', async () => {
  const f = await fixture();
  f.approved = true;
  assert.equal(
    (await f.tools.execute('request_note_folder', { folder: '.' }, 'one')).approved,
    true,
  );
  await f.tools.assertAllowed('root.md');
  await f.tools.assertAllowed('Other/private.md');
  await assert.rejects(f.tools.assertAllowed('.obsidian/data.md'));
  await assert.rejects(f.tools.assertAllowed('Other/.secrets/data.md'));
  f.vault.configDir = 'Config';
  await assert.rejects(f.tools.assertAllowed('Config/settings.md'));
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('aborting during snapshot persistence leaves notes untouched and preserves pending recovery', async () => {
  const saving = deferred();
  const release = deferred();
  const f = await fixture({
    save: async () => {
      saving.resolve();
      await release.promise;
    },
  });
  const controller = new AbortController();
  const pending = f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'new', expectedContent: 'original' },
    'cancelled',
    controller.signal,
  );
  await saving.promise;
  controller.abort();
  release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.notes.get('Notes/a.md'), 'original');
  assert.equal(f.tools.history[0].status, 'pending');
  await f.tools.undo('cancelled');
  assert.equal(f.notes.get('Notes/a.md'), 'original');
});
test('aborting during folder approval passes its signal and prevents a late grant', async () => {
  const asking = deferred();
  const release = deferred();
  const controller = new AbortController();
  const f = await fixture({
    approve: async (folder, signal) => {
      assert.equal(folder, 'Other');
      assert.equal(signal, controller.signal);
      asking.resolve();
      await release.promise;
    },
  });
  f.approved = true;
  const pending = f.tools.execute(
    'request_note_folder',
    { folder: 'Other' },
    'cancelled',
    controller.signal,
  );
  await asking.promise;
  controller.abort();
  release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(f.tools.assertAllowed('Other/private.md'), /outside/);
});
test('aborting while Vault.process waits prevents the guarded edit callback from writing', async () => {
  const processing = deferred();
  const release = deferred();
  const f = await fixture({
    process: async () => {
      processing.resolve();
      await release.promise;
    },
  });
  const controller = new AbortController();
  const pending = f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'new', expectedContent: 'original' },
    'cancelled',
    controller.signal,
  );
  await processing.promise;
  controller.abort();
  release.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.notes.get('Notes/a.md'), 'original');
});
test('an aborted queued call neither reads nor creates notes', async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.tools.execute('read_note', { path: 'Notes/a.md' }, 'cancelled', controller.signal),
    { name: 'AbortError' },
  );
  await assert.rejects(
    f.tools.execute(
      'create_note',
      { path: 'Notes/b.md', content: 'new' },
      'cancelled',
      controller.signal,
    ),
    { name: 'AbortError' },
  );
  assert.equal(f.notes.has('Notes/b.md'), false);
  assert.deepEqual(f.tools.history, []);
});
function editor(initial) {
  let value = initial;
  const changes = [];
  return {
    changes,
    getValue: () => value,
    offsetToPos: (offset) => ({ line: 0, ch: offset }),
    replaceRange: (text, from, to) => {
      changes.push({ text, from, to });
      value = value.slice(0, from.ch) + text + value.slice(to.ch);
    },
    type(text) {
      value = text;
    },
  };
}
test('open-note reads, edits and undo preserve unflushed text and native editor history', async () => {
  const active = editor('unsaved user text');
  const f = await fixture({ getEditor: (path) => (path === 'Notes/a.md' ? active : null) });
  assert.equal(
    (await f.tools.execute('read_note', { path: 'Notes/a.md' }, 'one')).content,
    'unsaved user text',
  );
  await f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'agent edit', expectedContent: 'unsaved user text' },
    'one',
  );
  assert.equal(active.getValue(), 'agent edit');
  assert.equal(
    f.notes.get('Notes/a.md'),
    'original',
    'closed-note storage is not used to overwrite an open editor',
  );
  assert.equal(f.tools.history[0].changes[0].before, 'unsaved user text');
  assert.equal(active.changes.length, 1);
  await f.tools.undo('one');
  assert.equal(active.getValue(), 'unsaved user text');
  assert.equal(active.changes.length, 2);
});
test('typing while an editor snapshot is persisted prevents the agent from overwriting the new text', async () => {
  const active = editor('unsaved user text');
  const saving = deferred();
  const release = deferred();
  const f = await fixture({
    getEditor: () => active,
    save: async () => {
      saving.resolve();
      await release.promise;
    },
  });
  const pending = f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'agent edit', expectedContent: 'unsaved user text' },
    'one',
  );
  await saving.promise;
  active.type('new user text');
  release.resolve();
  await assert.rejects(pending, /changed/);
  assert.equal(active.getValue(), 'new user text');
  assert.equal(active.changes.length, 0);
  assert.equal(f.tools.history[0].changes[0].before, 'unsaved user text');
});
test('deleting an open note snapshots its unflushed content and undo restores it', async () => {
  const active = editor('unsaved user text');
  const f = await fixture({ getEditor: (path) => (f?.files.has(path) ? active : null) });
  await f.tools.execute(
    'delete_note',
    { path: 'Notes/a.md', expectedContent: 'unsaved user text' },
    'one',
  );
  assert.deepEqual(f.trashed, ['Notes/a.md']);
  assert.equal(f.tools.history[0].changes[0].before, 'unsaved user text');
  await f.tools.undo('one');
  assert.equal(f.notes.get('Notes/a.md'), 'unsaved user text');
});
test('a note opened while a closed-note process waits is not overwritten', async () => {
  const active = editor('new user text');
  let opened = false;
  const processing = deferred();
  const release = deferred();
  const f = await fixture({
    getEditor: () => (opened ? active : null),
    process: async () => {
      processing.resolve();
      await release.promise;
    },
  });
  const pending = f.tools.execute(
    'edit_note',
    { path: 'Notes/a.md', content: 'agent edit', expectedContent: 'original' },
    'one',
  );
  await processing.promise;
  opened = true;
  release.resolve();
  await assert.rejects(pending, /opened in an editor/);
  assert.equal(active.getValue(), 'new user text');
  assert.equal(f.notes.get('Notes/a.md'), 'original');
});
test.after(async () => rm(temp, { recursive: true, force: true }));

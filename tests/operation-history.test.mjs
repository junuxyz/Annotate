import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const temp = await mkdtemp(join(tmpdir(), 'annotate-history-'));
await build({
  entryPoints: ['src/operation-history.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(temp, 'history.cjs'),
  plugins: [
    {
      name: 'obsidian',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'mock',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: 'export class FileSystemAdapter {}; export class TFile {};',
        }));
      },
    },
  ],
});
const { OperationHistoryStore } = createRequire(import.meta.url)(join(temp, 'history.cjs'));
const record = (id) => ({
  id,
  createdAt: 1,
  status: 'complete',
  changes: [{ path: 'Notes/a.md', before: 'old', after: id }],
});
function fixture() {
  const files = new Map();
  let exists = false;
  const adapter = {
    exists: async () => exists,
    mkdir: async () => {
      exists = true;
    },
    list: async () => ({ files: [...files.keys()], folders: [] }),
    read: async (path) => {
      if (!files.has(path)) throw Error('missing');
      return files.get(path);
    },
    write: async (path, text) => {
      files.set(path, text);
    },
  };
  const store = () => new OperationHistoryStore({ adapter, directory: 'private/agent-history' });
  return { files, adapter, store };
}
test('sequential snapshots load and reload, retain all ancestors, and copy caller data', async () => {
  const f = fixture();
  const store = f.store();
  assert.deepEqual(await store.load(), []);
  const records = [record('first')];
  await store.save(records);
  records[0].changes[0].before = 'mutated caller';
  assert.deepEqual(await f.store().load(), [record('first')]);
  await store.save([record('first'), record('second')]);
  assert.equal(f.files.size, 2);
  assert.deepEqual(await f.store().load(), [record('first'), record('second')]);
  const nodes = [...f.files.entries()].sort();
  assert.equal(JSON.parse(nodes[0][1]).parent, null);
  assert.equal(JSON.parse(nodes[1][1]).parent, nodes[0][0].split('/').at(-1));
});
test('an independently saved revision rejects a stale writer without deleting data', async () => {
  const f = fixture();
  const a = f.store(),
    b = f.store();
  await a.load();
  await b.load();
  await a.save([record('a')]);
  await assert.rejects(b.save([record('b')]), /Note changes are blocked/);
  assert.equal(f.files.size, 1);
  assert.deepEqual(await f.store().load(), [record('a')]);
});
test('concurrent sibling snapshots remain preserved and reload fails closed', async () => {
  const f = fixture();
  const seed = f.store();
  await seed.load();
  await seed.save([record('seed')]);
  const a = f.store(),
    b = f.store();
  await a.load();
  await b.load();
  let written = 0;
  let release;
  const bothWritten = new Promise((resolve) => {
    release = resolve;
  });
  f.adapter.write = async (path, text) => {
    f.files.set(path, text);
    if (++written === 2) release();
    await bothWritten;
  };
  const results = await Promise.allSettled([a.save([record('a')]), b.save([record('b')])]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(f.files.size, 3);
  await assert.rejects(f.store().load(), /Preserve every agent-history file/);
});
test('corrupted snapshots and missing parents block reload without modifying files', async () => {
  const f = fixture();
  const store = f.store();
  await store.load();
  await store.save([record('first')]);
  await store.save([record('second')]);
  const entries = [...f.files.entries()].sort();
  f.files.set(entries[1][0], '{interrupted');
  await assert.rejects(f.store().load(), /history changed or is damaged/);
  assert.equal(f.files.get(entries[0][0]), entries[0][1]);
  f.files.set(entries[1][0], entries[1][1]);
  f.files.delete(entries[0][0]);
  await assert.rejects(f.store().load(), /history changed or is damaged/);
  assert.equal(f.files.get(entries[1][0]), entries[1][1]);
});
test('an interrupted backup preserves prior snapshots and blocks the caller note write', async () => {
  const f = fixture();
  const store = f.store();
  await store.load();
  await store.save([record('first')]);
  const previous = [...f.files.entries()];
  f.adapter.write = async (path) => {
    f.files.set(path, '{partial');
    throw Error('disk full');
  };
  let note = 'original';
  async function changeNote() {
    await store.save([record('second')]);
    note = 'changed';
  }
  await assert.rejects(changeNote(), /Note changes are blocked/);
  assert.equal(note, 'original');
  assert.equal(f.files.get(previous[0][0]), previous[0][1]);
  assert.equal(f.files.size, 2);
  await assert.rejects(f.store().load(), /history changed or is damaged/);
  await assert.rejects(store.save([record('third')]), /history changed or is damaged/);
});
test('load rejects cycles and multiple roots, and save requires successful load', async () => {
  const f = fixture();
  const store = f.store();
  await assert.rejects(store.save([]), /Note changes are blocked/);
  await store.load();
  await store.save([record('first')]);
  await store.save([record('second')]);
  const entries = [...f.files.entries()].sort();
  const first = JSON.parse(entries[0][1]);
  first.parent = entries[1][0].split('/').at(-1);
  f.files.set(entries[0][0], JSON.stringify(first));
  await assert.rejects(f.store().load(), /history changed or is damaged/);
  first.parent = null;
  f.files.set(entries[0][0], JSON.stringify(first));
  const second = JSON.parse(entries[1][1]);
  second.parent = null;
  f.files.set(entries[1][0], JSON.stringify(second));
  await assert.rejects(f.store().load(), /history changed or is damaged/);
});
test.after(async () => rm(temp, { recursive: true, force: true }));

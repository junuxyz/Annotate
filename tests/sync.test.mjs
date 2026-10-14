import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const root = await mkdtemp(join(tmpdir(), 'annotate-sync-'));
const bundle = join(root, 'sync.cjs');
await build({
  entryPoints: ['src/sync.ts'],
  bundle: true,
  outfile: bundle,
  platform: 'node',
  format: 'cjs',
});
const { syncLocalBuild } = createRequire(import.meta.url)(bundle);
after(() => rm(root, { recursive: true, force: true }));
async function fixture() {
  const source = await mkdtemp(join(root, 'source-'));
  for (const [file, content] of Object.entries({
    'main.js': 'new code',
    'manifest.json': '{"id":"annotate","version":"0.3.1"}',
    'styles.css': 'new style',
  }))
    await writeFile(join(source, file), content);
  const stored = new Map([
    ['plugin/main.js', 'old code'],
    ['plugin/manifest.json', 'old manifest'],
    ['plugin/styles.css', 'old style'],
    ['plugin/data.json', 'saved comments'],
  ]);
  let enabled = true;
  const options = {
    source,
    destination: 'plugin',
    adapter: {
      read: async (file) => stored.get(file),
      write: async (file, content) => stored.set(file, content),
    },
    disable: async () => {
      enabled = false;
    },
    enable: async () => {
      enabled = true;
    },
  };
  return { options, stored, enabled: () => enabled };
}
test('sync installs build, reloads and preserves comment data', async () => {
  const f = await fixture();
  assert.equal(await syncLocalBuild(f.options), '0.3.1');
  assert.equal(
    f.stored.get('plugin/main.js'),
    await readFile(join(f.options.source, 'main.js'), 'utf8'),
  );
  assert.equal(f.stored.get('plugin/data.json'), 'saved comments');
  assert.equal(f.enabled(), true);
});
test('invalid or missing build leaves running plugin untouched', async () => {
  const f = await fixture();
  await writeFile(join(f.options.source, 'manifest.json'), '{"id":"other","version":"1"}');
  await assert.rejects(syncLocalBuild(f.options));
  assert.equal(f.stored.get('plugin/main.js'), 'old code');
  assert.equal(f.enabled(), true);
  await rm(join(f.options.source, 'main.js'));
  await assert.rejects(syncLocalBuild(f.options));
  assert.equal(f.enabled(), true);
});
test('failed load restores previous files and re-enables plugin', async () => {
  const f = await fixture();
  const original = new Map(f.stored);
  let loads = 0;
  f.options.enable = async () => {
    if (++loads === 1) throw new Error('load failed');
  };
  await assert.rejects(syncLocalBuild(f.options), /load failed/);
  assert.deepEqual(f.stored, original);
  assert.equal(loads, 2);
});
test('partial copy failure restores previous files', async () => {
  const f = await fixture();
  const original = new Map(f.stored);
  let writes = 0;
  const write = f.options.adapter.write;
  f.options.adapter.write = async (...args) => {
    if (++writes === 2) throw new Error('write failed');
    return write(...args);
  };
  await assert.rejects(syncLocalBuild(f.options), /write failed/);
  assert.deepEqual(f.stored, original);
  assert.equal(f.enabled(), true);
});

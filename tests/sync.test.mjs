import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { publishDevelopmentBuild } from '../scripts/development-build.mjs';
import { until } from './assertions.mjs';
const root = await mkdtemp(join(tmpdir(), 'annotate-sync-'));
const bundle = join(root, 'sync.cjs');
await build({
  entryPoints: ['src/sync.ts'],
  bundle: true,
  outfile: bundle,
  platform: 'node',
  format: 'cjs',
});
const { syncLocalBuild, watchDevelopmentBuild } = createRequire(import.meta.url)(bundle);
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

async function publish(fixture, code = 'updated development code') {
  const contents = [
    code,
    await readFile(join(fixture.options.source, 'manifest.json'), 'utf8'),
    'updated development style',
  ];
  return publishDevelopmentBuild(fixture.options.source, contents);
}
test('development sync rejects distribution and incomplete builds before unloading', async () => {
  const f = await fixture();
  f.options.development = true;
  await assert.rejects(syncLocalBuild(f.options));
  assert.equal(f.enabled(), true);
  await publish(f);
  await writeFile(join(f.options.source, 'main.js'), 'half-written build');
  await assert.rejects(syncLocalBuild(f.options), /incomplete/);
  assert.equal(f.stored.get('plugin/main.js'), 'old code');
});
test('automatic development updates defer while busy, coalesce, preserve data and stop on unload', async () => {
  const f = await fixture();
  f.options.development = true;
  await publish(f, 'first development build');
  await syncLocalBuild(f.options);
  let ready = false,
    updates = 0;
  const stop = await watchDevelopmentBuild({
    ...f.options,
    intervalMs: 15,
    ready: () => ready,
    apply: async () => {
      updates++;
      await syncLocalBuild(f.options);
      return true;
    },
  });
  try {
    await publish(f, 'second development build');
    await publish(f, 'latest development build');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(updates, 0);
    ready = true;
    await until(() => updates === 1, 'pending update applies when idle');
    await until(
      () => f.stored.get('plugin/main.js') === 'latest development build',
      'latest complete build installed',
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(updates, 1);
    assert.equal(f.stored.get('plugin/data.json'), 'saved comments');
    stop();
    await publish(f, 'after unload');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(updates, 1);
  } finally {
    stop();
  }
});
test('failed automatic revision is remembered across rollback and retried only after a new build', async () => {
  const f = await fixture();
  f.options.development = true;
  const revision = await publish(f);
  const original = f.stored.get('plugin/main.js');
  let loads = 0;
  f.options.enable = async () => {
    if (++loads === 1) throw new Error('invalid development code');
  };
  await assert.rejects(syncLocalBuild(f.options));
  assert.equal(f.stored.get('plugin/main.js'), original);
  assert.equal(
    JSON.parse(f.stored.get('plugin/development-state.json')).lastAttempt,
    revision.buildId,
  );
  let attempts = 0;
  const stop = await watchDevelopmentBuild({
    ...f.options,
    intervalMs: 15,
    ready: () => true,
    apply: async () => {
      attempts++;
      await syncLocalBuild(f.options);
      return true;
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(attempts, 0);
    await publish(f, 'fixed development code');
    await until(() => attempts === 1, 'new revision retries');
  } finally {
    stop();
  }
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { bundleBanner, verifyRelease } from '../scripts/release.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'annotate-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => writeFileSync(resolve(root, name), value);
  const json = (name, value) => put(name, JSON.stringify(value));
  const manifest = { id: 'annotate', version: '0.3.1', minAppVersion: '1.5.0' };
  json('manifest.json', manifest);
  json('package.json', { version: manifest.version });
  json('package-lock.json', {
    version: manifest.version,
    packages: { '': { version: manifest.version } },
  });
  json('versions.json', { [manifest.version]: manifest.minAppVersion });
  put('styles.css', '.annotate {}');
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    put(name, readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
  const bundle = (development = false) =>
    put('main.js', `${bundleBanner(root, development)}\nmodule.exports = {};`);
  bundle();
  return { root, put, json, manifest, bundle };
}

test('distribution preserves full license notices through minification and verifies exact hashes', async (t) => {
  const { root, put } = fixture(t);
  const result = await build({
    stdin: { contents: 'module.exports = { answer: 42 };' },
    write: false,
    minify: true,
    banner: { js: bundleBanner(root, false) },
  });
  put('main.js', result.outputFiles[0].text);
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    assert.ok(
      result.outputFiles[0].text.includes(readFileSync(resolve(root, name), 'utf8').trim()),
    );
  const hashes = verifyRelease(root, { tag: '0.3.1' });
  assert.deepEqual(Object.keys(hashes.files), ['main.js', 'manifest.json', 'styles.css']);
  assert.deepEqual(verifyRelease(root, { hashes }), hashes);
  put('main.js', `${result.outputFiles[0].text}\nmodule.exports.extra = true;`);
  assert.throws(() => verifyRelease(root, { hashes }), /hash mismatch: main.js/);
});

test('rejects development bundles and missing notices', (t) => {
  const { root, put, bundle } = fixture(t);
  bundle(true);
  assert.throws(() => verifyRelease(root), /development build/);
  put('main.js', 'module.exports = {};');
  assert.throws(() => verifyRelease(root), /missing distribution license notices/);
});

test('rejects old plugin identity, stale versions, and prefixed tags', (t) => {
  const { root, manifest, json, bundle } = fixture(t);
  assert.throws(() => verifyRelease(root, { tag: 'v0.3.1' }), /without a v prefix/);
  json('manifest.json', { ...manifest, id: 'selection-comments' });
  bundle();
  assert.throws(() => verifyRelease(root), /id must be annotate/);
  json('manifest.json', { ...manifest, version: '0.3.2' });
  assert.throws(() => verifyRelease(root), /versions.*do not match/);
  json('manifest.json', manifest);
  json('versions.json', { '0.3.1': '1.4.0' });
  assert.throws(() => verifyRelease(root), /minimum app versions do not match/);
});

test('rejects a changed stylesheet or manifest after build', (t) => {
  const { root, put, json, manifest, bundle } = fixture(t);
  put('styles.css', '.annotate { color: red; }');
  assert.throws(() => verifyRelease(root), /Build is stale/);
  bundle();
  json('manifest.json', { ...manifest, name: 'Changed after build' });
  assert.throws(() => verifyRelease(root), /Build is stale/);
});

test('rejects leaked development paths and invalid validated hash records', (t) => {
  const { root, put } = fixture(t);
  assert.throws(
    () => verifyRelease(root, { hashes: { version: '0.3.0', files: {} } }),
    /hash record/,
  );
  put(
    'main.js',
    `${bundleBanner(root, false)}\nconst developmentPath = ${JSON.stringify(resolve(root, '.development'))};`,
  );
  assert.throws(() => verifyRelease(root), /absolute development path/);
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { bundleBanner, releaseFiles } from '../scripts/release.mjs';
import { stageRelease } from '../scripts/stage-release.mjs';

const commit = 'a'.repeat(40);
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'annotate-provenance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = { id: 'annotate', version: '0.4.1', minAppVersion: '1.14.4' };
  for (const [name, value] of Object.entries({
    'manifest.json': manifest,
    'package.json': { version: manifest.version },
    'package-lock.json': {
      version: manifest.version,
      packages: { '': { version: manifest.version } },
    },
    'versions.json': { [manifest.version]: manifest.minAppVersion },
  }))
    writeFileSync(resolve(root, name), JSON.stringify(value));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    writeFileSync(resolve(root, name), readFileSync(new URL(`../${name}`, import.meta.url)));
  writeFileSync(resolve(root, 'styles.css'), '.annotate {}');
  writeFileSync(resolve(root, 'main.js'), `${bundleBanner(root, false)}\nmodule.exports = {};`);
  return { root, destination: resolve(root, 'evidence') };
}

test('stages only distribution files byte for byte, with their verified hashes and exact commit', (t) => {
  const { root, destination } = fixture(t);
  writeFileSync(resolve(root, 'private-note.md'), 'Must never enter the release.');
  const hashes = stageRelease(root, destination, commit);
  const distribution = resolve(destination, 'distribution');
  assert.deepEqual(readdirSync(distribution).sort(), [...releaseFiles].sort());
  for (const name of releaseFiles)
    assert.deepEqual(readFileSync(resolve(distribution, name)), readFileSync(resolve(root, name)));
  assert.deepEqual(JSON.parse(readFileSync(resolve(destination, 'validated-build.json'))), hashes);
  assert.equal(readFileSync(resolve(destination, 'validated-commit.txt'), 'utf8'), `${commit}\n`);
});

test('refuses stale builds, symbolic refs, and a reused staging directory', (t) => {
  const { root, destination } = fixture(t);
  assert.throws(() => stageRelease(root, destination, 'main'), /exact release commit/);
  stageRelease(root, destination, commit);
  assert.throws(() => stageRelease(root, destination, commit), /must be empty/);
  writeFileSync(resolve(root, 'styles.css'), '.annotate { color: red; }');
  assert.throws(() => stageRelease(root, resolve(root, 'other-evidence'), commit), /stale/);
});

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseFiles, verifyRelease } from './release.mjs';

// Call only after check:release succeeds. This copies files without rebuilding them.
export function stageRelease(root, destination, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('An exact release commit is required.');
  const hashes = verifyRelease(root);
  const distribution = resolve(destination, 'distribution');
  mkdirSync(distribution, { recursive: true });
  if (readdirSync(distribution).length)
    throw new Error('Distribution staging directory must be empty.');
  for (const name of releaseFiles) {
    const staged = resolve(distribution, name);
    copyFileSync(resolve(root, name), staged);
    const actual = createHash('sha256').update(readFileSync(staged)).digest('hex');
    if (actual !== hashes.files[name]) throw new Error(`Staged build hash mismatch: ${name}`);
  }
  writeFileSync(
    resolve(destination, 'validated-build.json'),
    `${JSON.stringify(hashes, null, 2)}\n`,
  );
  writeFileSync(resolve(destination, 'validated-commit.txt'), `${commit}\n`);
  return hashes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_SHA !== commit)
    throw new Error('Workflow identity must match the validated release commit.');
  stageRelease(root, resolve(root, 'e2e/evidence'), commit);
}

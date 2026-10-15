// Run the same disposable Linux/Xvfb environment used by CI.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = createHash('sha1').update(root).digest('hex').slice(0, 8);
const image = `annotate-e2e-${key}`;
const evidence = join(root, 'e2e/evidence', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(evidence, { recursive: true });
const run = (args) => {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw new Error(`Docker is required for local E2E: ${result.error.message}`);
  return result.status ?? 1;
};
const built = run(['build', '-f', 'e2e/Dockerfile', '-t', image, '.']);
if (built) process.exit(built);
const result = run([
  'run',
  '--rm',
  '--init',
  '--memory',
  '2g',
  '--memory-swap',
  '2g',
  '--pids-limit',
  '256',
  '--cpus',
  '2',
  '-e',
  `ANNOTATE_DEV_BUILD=${process.argv.includes('--dev-build') ? '1' : '0'}`,
  '-v',
  `${evidence}:/evidence`,
  image,
  ...process.argv.slice(2).filter((arg) => arg !== '--dev-build'),
]);
const report = join(evidence, 'Validation results.md');
if (existsSync(report)) {
  const vault = existsSync(join(root, '../test-vault'))
    ? join(root, '../test-vault')
    : join(root, 'test-vault');
  appendFileSync(join(vault, 'Validation results.md'), readFileSync(report));
}
console.log(`E2E evidence: ${evidence}`);
process.exit(result);

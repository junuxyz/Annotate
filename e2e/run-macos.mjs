import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCompatibility, inspectInstallation } from './macos/runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
checkCompatibility(inspectInstallation().actual);
const args = process.argv.slice(2);
const full = args.includes('--full');
const dev = args.includes('--dev-build');
const forwarded = args.filter((a) => !['--full', '--dev-build'].includes(a));
if (full && (dev || forwarded.some((a) => !['--shots', '--record'].includes(a))))
  throw Error('--full accepts only --shots and --record; it selects all offline scopes.');
const output = join(root, 'e2e/evidence', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
let child,
  interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
const run = (command, values, env = process.env) =>
  new Promise((resolveRun, reject) => {
    child = spawn(command, values, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolveRun()
        : reject(Error(`${command} ${values.join(' ')} failed (${signal || code})`)),
    );
  });
const suites = full
  ? [
      ['--only', 'smoke,ui,list,polish,settings-layout,fullscreen'],
      ['--only', 'highlight,palette'],
      ['--only', 'formatting,combo,logos'],
      ['--only', 'scroll,markdown,math'],
      ['--only', 'quote,copy,preview'],
      ['--only', 'memory,resources,storage,distribution'],
      ['--only', 'access'],
      ['--only', 'providers'],
      ['--only', 'shortcuts'],
      ...[
        'core-checks.mjs',
        'anchor-checks.mjs',
        'editing-checks.mjs',
        'math-checks.mjs',
        'menu-checks.mjs',
      ].map((name) => ['--only', 'smoke', '--scenario', name]),
      ['--only', 'smoke,sync,auto-update', '--development'],
    ].map((suite) => [
      ...suite,
      '--modes',
      'live,source,reading',
      '--record',
      ...forwarded.filter((a) => a !== '--record'),
    ])
  : [forwarded];
const summary = [];
try {
  await run('npm', ['run', 'lint']);
  await run('npm', ['run', dev ? 'build:dev' : 'build']);
  await run('npm', ['test']);
  for (let i = 0; i < suites.length; i++) {
    const evidence = join(output, `suite-${i + 1}`);
    mkdirSync(evidence);
    const development = suites[i].includes('--development');
    if (development) await run('npm', ['run', 'build:dev']);
    try {
      await run(
        process.execPath,
        ['e2e/dev-check.mjs', ...suites[i].filter((a) => a !== '--development')],
        {
          ...process.env,
          E2E_OUTPUT: evidence,
        },
      );
      summary.push({ suite: suites[i], status: 'passed', evidence: `suite-${i + 1}` });
    } catch (error) {
      summary.push({
        suite: suites[i],
        status: 'failed',
        error: error.message,
        evidence: `suite-${i + 1}`,
      });
      if (!full || interrupted) throw error;
    } finally {
      if (development) await run('npm', ['run', 'build']);
    }
    const report = join(evidence, 'Validation results.md');
    if (existsSync(report) && (full || args.includes('--record'))) {
      const vault = existsSync(join(root, '../test-vault'))
        ? join(root, '../test-vault')
        : join(root, 'test-vault');
      appendFileSync(join(vault, 'Validation results.md'), readFileSync(report));
    }
  }
  if (summary.some((s) => s.status === 'failed')) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        suites: summary,
        pending: [
          'Live authenticated Codex/Claude checks; no personal credentials copied',
          'Native success paths intentionally denied by offscreen guards',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`E2E evidence: ${output}`);
}

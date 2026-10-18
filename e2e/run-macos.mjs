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
const keepGoing = args.includes('--keep-going');
const selection = args.indexOf('--unit-tests');
let unitTests;
if (selection !== -1) {
  unitTests = args[selection + 1];
  if (!unitTests || unitTests.startsWith('--') || args.lastIndexOf('--unit-tests') !== selection)
    throw Error('--unit-tests requires a comma-separated list of test filenames.');
  args.splice(selection, 2);
}
if (keepGoing && !full) throw Error('--keep-going is only available with --full.');
if (full && unitTests) throw Error('--full always runs all unit tests.');
const forwarded = args.filter((a) => !['--full', '--dev-build', '--keep-going'].includes(a));
if (full && (dev || forwarded.some((a) => !['--shots', '--record'].includes(a))))
  throw Error(
    '--full accepts only --shots, --record and --keep-going; it selects all offline scopes.',
  );
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
      ['--only', 'highlight,palette,comment-formatting'],
      ['--only', 'highlight-seams,highlight-saved-seams,formatting,combo,logos'],
      ['--only', 'inline-code'],
      ['--only', 'inline-ui'],
      ['--only', 'emphasis-edges'],
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
const summary = suites.map((suite, i) => ({
  suite,
  status: 'pending',
  evidence: `suite-${i + 1}`,
  rerun: [
    'npm',
    'run',
    'check',
    '--',
    ...(dev || suite.includes('--development') ? ['--dev-build'] : []),
    ...suite.filter((a) => a !== '--development'),
  ].join(' '),
}));
try {
  await run('npm', ['run', 'lint']);
  await run('npm', ['run', dev ? 'build:dev' : 'build']);
  await run('npm', ['test', ...(unitTests ? ['--', '--files', unitTests] : [])]);
  for (let i = 0; i < suites.length; i++) {
    const evidence = join(output, `suite-${i + 1}`);
    mkdirSync(evidence);
    const development = suites[i].includes('--development');
    if (development) await run('npm', ['run', 'build:dev']);
    let suiteError;
    try {
      await run(
        process.execPath,
        ['e2e/dev-check.mjs', ...suites[i].filter((a) => a !== '--development')],
        {
          ...process.env,
          E2E_OUTPUT: evidence,
        },
      );
      summary[i].status = 'passed';
    } catch (error) {
      summary[i].status = 'failed';
      summary[i].error = error.message;
      suiteError = error;
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
    if (suiteError) {
      console.error(`Rerun failed scope: ${summary[i].rerun}`);
      if (!keepGoing || interrupted) throw suiteError;
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
        unitTests: unitTests ? unitTests.split(',') : 'all',
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

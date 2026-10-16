import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

async function fixture(args, { failPreflight = false, failSuite = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'annotate-check-runner-'));
  await mkdir(join(directory, 'e2e/macos'), { recursive: true });
  await mkdir(join(directory, 'test-vault'));
  await copyFile(resolve('e2e/run-macos.mjs'), join(directory, 'e2e/run-macos.mjs'));
  // These fixture commands only log scheduling. They never launch an application.
  await writeFile(
    join(directory, 'e2e/macos/runtime.mjs'),
    'export const inspectInstallation=()=>({actual:{}});export const checkCompatibility=()=>{};',
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      scripts: Object.fromEntries(
        ['lint', 'build', 'build:dev', 'test'].map((name) => [name, `node preflight.mjs ${name}`]),
      ),
    }),
  );
  await writeFile(
    join(directory, 'preflight.mjs'),
    `import {appendFileSync} from 'node:fs';
     appendFileSync('calls.jsonl', JSON.stringify(process.argv.slice(2))+'\\n');
     if (${failPreflight} && process.argv[2]==='test') process.exit(1);`,
  );
  await writeFile(
    join(directory, 'e2e/dev-check.mjs'),
    `import {appendFileSync,writeFileSync} from 'node:fs';
     import {join} from 'node:path';
     appendFileSync('calls.jsonl', JSON.stringify(['app',...process.argv.slice(2)])+'\\n');
     writeFileSync(join(process.env.E2E_OUTPUT,'Validation results.md'),'synthetic suite report\\n');
     if (${failSuite}) process.exit(1);`,
  );
  let output;
  let code = 0;
  try {
    const result = await execute(process.execPath, ['e2e/run-macos.mjs', ...args], {
      cwd: directory,
      timeout: 20_000,
    });
    output = result.stdout + result.stderr;
  } catch (error) {
    code = error.code;
    output = error.stdout + error.stderr;
  }
  const evidence = output.match(/E2E evidence: (.+)/)?.[1];
  const summary = evidence
    ? JSON.parse(await readFile(join(evidence, 'summary.json'), 'utf8'))
    : null;
  let calls = [];
  try {
    calls = (await readFile(join(directory, 'calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { directory, code, output, summary, calls };
}

test('full validation stops at the first failure and records unrun suites as pending', async () => {
  const result = await fixture(['--full', '--record']);
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.deepEqual(result.calls.slice(0, 3), [['lint'], ['build'], ['test']]);
    assert.equal(result.calls.filter(([name]) => name === 'app').length, 1);
    assert.equal(result.summary.suites[0].status, 'failed');
    assert.ok(result.summary.suites.slice(1).every((suite) => suite.status === 'pending'));
    assert.match(result.output, /Rerun failed scope: npm run check -- --only/);
    assert.equal(
      await readFile(join(result.directory, 'test-vault/Validation results.md'), 'utf8'),
      'synthetic suite report\n',
    );
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('preflight failure prevents every real-app suite', async () => {
  const result = await fixture(['--full'], { failPreflight: true });
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.equal(result.calls.filter(([name]) => name === 'app').length, 0);
    assert.ok(result.summary.suites.every((suite) => suite.status === 'pending'));
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('explicit diagnostic runs continue after failures but still fail overall', async () => {
  const result = await fixture(['--full', '--keep-going']);
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.ok(result.summary.suites.length > 1);
    assert.ok(result.summary.suites.every((suite) => suite.status === 'failed'));
    assert.equal(
      result.calls.filter(([name]) => name === 'app').length,
      result.summary.suites.length,
    );
    assert.deepEqual(result.calls.at(-1), ['build']);
    assert.match(result.summary.suites.at(-1).rerun, /--dev-build/);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('scoped runs forward unit selections and full runs reject incomplete unit coverage', async () => {
  const result = await fixture(['--only', 'smoke', '--unit-tests', 'example.test.mjs'], {
    failSuite: false,
  });
  try {
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(result.calls[2], ['test', '--files', 'example.test.mjs']);
    assert.deepEqual(result.calls[3], ['app', '--only', 'smoke']);
    assert.deepEqual(result.summary.unitTests, ['example.test.mjs']);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
  const rejected = await fixture(['--full', '--unit-tests', 'example.test.mjs']);
  try {
    assert.notEqual(rejected.code, 0, rejected.output);
    assert.match(rejected.output, /--full always runs all unit tests/);
    assert.deepEqual(rejected.calls, []);
  } finally {
    await rm(rejected.directory, { recursive: true, force: true });
  }
});

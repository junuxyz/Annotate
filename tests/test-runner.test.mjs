import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function fixture(source, limits, args = [], extraTests = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'annotate-runner-test-'));
  await mkdir(join(directory, 'tests'));
  await symlink(
    resolve('node_modules'),
    join(directory, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await writeFile(join(directory, 'tests/fixture.test.mjs'), source);
  for (const [name, text] of Object.entries(extraTests))
    await writeFile(join(directory, 'tests', name), text);
  const environment = { ...process.env, ANNOTATE_TEST_TIMEOUT_MS: '2000', ...limits };
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [resolve('scripts/test.mjs'), ...args], {
    cwd: directory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output += chunk;
    });
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { directory, code, output };
}

test('test deadline terminates the worker and its spawned child', async () => {
  const result = await fixture(`
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
    writeFileSync('child.pid',String(child.pid));
    setInterval(()=>{},1000);
  `);
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /deadline exceeded/);
    const pid = Number(await readFile(join(result.directory, 'child.pid'), 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('RSS guard stops a hanging test without allocating a large payload', async () => {
  const result = await fixture('setInterval(()=>{},1000)', { ANNOTATE_TEST_RSS_MIB: '1' });
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /process tree exceeded 1 MiB RSS/);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('output guard stops a runaway reporter', async () => {
  const result = await fixture("process.stdout.write('x'.repeat(8192));setInterval(()=>{},1000)", {
    ANNOTATE_TEST_OUTPUT_BYTES: '1024',
  });
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /output exceeded 1024 bytes/);
    assert.ok(result.output.length < 4096);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('limits cannot be raised beyond the configured safety ceilings', async () => {
  const result = await fixture('process.exit(0)', { ANNOTATE_TEST_RSS_MIB: '100000' });
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /must be between 1 and 768/);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('file selection runs only requested suites and forwards Node test options', async () => {
  const result = await fixture(
    `import { test } from 'node:test';
     test('selected', () => {});
     test('unselected case', () => { throw Error('must not run'); });`,
    {},
    ['--files', 'fixture.test.mjs', '--test-name-pattern', '^selected$'],
    { 'other.test.mjs': "throw Error('unselected suite must not run');" },
  );
  try {
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Testing fixture\.test\.mjs/);
    assert.doesNotMatch(result.output, /Testing other\.test\.mjs/);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('invalid file selections fail without running any suites', async () => {
  for (const args of [
    ['--files'],
    ['--files', ''],
    ['--files', 'missing.test.mjs'],
    ['--files', 'fixture.test.mjs,missing.test.mjs'],
    ['--files', '../fixture.test.mjs'],
    ['--files', 'fixture.test.mjs', '--files', 'fixture.test.mjs'],
  ]) {
    const result = await fixture("throw Error('must not run');", {}, args);
    try {
      assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /--files requires/);
      assert.doesNotMatch(result.output, /Testing fixture/);
    } finally {
      await rm(result.directory, { recursive: true, force: true });
    }
  }
});

test('selected suites retain the deadline guard', async () => {
  const result = await fixture('setInterval(()=>{},1000)', { ANNOTATE_TEST_TIMEOUT_MS: '300' }, [
    '--files',
    'fixture.test.mjs',
  ]);
  try {
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /deadline exceeded/);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = mkdtempSync(join(tmpdir(), 'annotate-assistants-test-'));
await build({
  entryPoints: ['src/ai.ts', 'src/model.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: root,
});
const { assistantInvocation } = createRequire(import.meta.url)(join(root, 'ai.js'));
const { dataSchema } = createRequire(import.meta.url)(join(root, 'model.js'));
await build({
  entryPoints: ['src/claude.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(root, 'cli.cjs'),
});
const { ClaudeBackend } = createRequire(import.meta.url)(join(root, 'cli.cjs'));
const fixture = resolve('tests/assistant-fixture.cjs');
after(() => rmSync(root, { recursive: true, force: true }));
function request(backend, id, question, cancel = false) {
  return new Promise(async (resolve, reject) => {
    let body = '',
      calls = 0;
    try {
      await backend.ask(
        id,
        JSON.stringify({
          noteText: '# Synthetic 한글 note',
          selectedPassage: 'selected',
          question,
          conversationHistory: [{ role: 'assistant', content: 'prior answer' }],
        }),
        (chunk) => (body += chunk),
        (state, error) => {
          calls++;
          resolve({ body, state, error, calls });
        },
      );
      if (cancel) await backend.interrupt(id);
    } catch (error) {
      reject(error);
    }
  });
}
test('mentions route exactly one assistant and legacy settings default to ChatGPT', () => {
  for (const provider of ['chatgpt', 'claude'])
    assert.deepEqual(assistantInvocation(`Please @${provider.toUpperCase()} explain`), {
      provider,
      question: 'Please  explain',
    });
  assert.equal(assistantInvocation('mail@claude.com'), null);
  assert.throws(() => assistantInvocation('@claude @chatgpt question'), /one assistant/);
  const data = dataSchema.parse({
    version: 1,
    author: 'You',
    threads: [],
    codex: { enabled: true, executable: 'saved-codex' },
  });
  assert.equal(data.assistant.provider, 'chatgpt');
  assert.equal(data.codex.executable, 'saved-codex');
});
for (const provider of ['claude']) {
  test(`${provider}: real child process streams context once, handles cancellation, failures and recovery`, async () => {
    const backend = new ClaudeBackend(fixture, 'synthetic-model', () => {});
    try {
      await backend.enable();
      assert.equal(backend.state, 'ready');
      const id = await backend.session();
      const result = await request(backend, id, 'explain');
      assert.equal(result.state, 'completed');
      assert.equal(result.calls, 1);
      const payload = JSON.parse(result.body);
      assert.equal(payload.noteText, '# Synthetic 한글 note');
      assert.equal(payload.conversationHistory[0].content, 'prior answer');
      assert.equal((await request(backend, id, 'cancel', true)).state, 'cancelled');
      assert.equal((await request(backend, id, 'crash')).state, 'unknown');
      assert.equal((await request(backend, id, 'malformed')).state, 'unknown');
      assert.equal((await request(backend, id, 'failed')).state, 'failed');
      assert.equal((await request(backend, id, 'recovered')).state, 'completed');
      backend.disable();
      assert.equal(backend.state, 'disabled');
      await backend.enable();
      assert.equal((await request(backend, id, 'after reload')).state, 'completed');
    } finally {
      backend.disable();
    }
  });
}
test('Claude adapter rejects API-key login', async () => {
  const apiFixture = join(root, 'api-login');
  symlinkSync(fixture, apiFixture);
  const backend = new ClaudeBackend(apiFixture, 'sonnet', () => {});
  try {
    await assert.rejects(backend.enable(), /subscription/);
  } finally {
    backend.disable();
  }
});

test('Claude reports a revoked login as a connection error and recovers after reconnect', async () => {
  const cli = join(root, 'auth-toggle');
  const marker = join(root, 'revoked');
  writeFileSync(
    cli,
    readFileSync(fixture, 'utf8').replace(
      'loggedIn: true',
      "loggedIn: !require('node:fs').existsSync(require('node:path').join(__dirname,'revoked'))",
    ),
    { mode: 0o700 },
  );
  const backend = new ClaudeBackend(cli, 'sonnet', () => {});
  try {
    await backend.enable();
    writeFileSync(marker, '');
    await assert.rejects(request(backend, await backend.session(), 'explain'), /subscription/);
    assert.equal(backend.state, 'error');
    assert.match(backend.detail, /subscription/);
    rmSync(marker);
    await backend.connect();
    assert.equal(backend.state, 'ready');
    assert.equal((await request(backend, await backend.session(), 'recovered')).state, 'completed');
  } finally {
    backend.disable();
    rmSync(marker, { force: true });
  }
});

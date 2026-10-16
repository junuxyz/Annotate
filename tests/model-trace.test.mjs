import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { modelTrace, traceRequest } from '../scripts/model-trace.mjs';

const root = mkdtempSync(join(tmpdir(), 'annotate-trace-replay-'));
await build({
  entryPoints: ['src/codex.ts', 'src/claude.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: root,
});
const require = createRequire(import.meta.url);
const { CodexBackend } = require(join(root, 'codex.js'));
const { ClaudeBackend } = require(join(root, 'claude.js'));
after(() => rmSync(root, { recursive: true, force: true }));

for (const provider of ['codex', 'claude']) {
  test(`${provider}: real backend consumes the recorded synthetic model stream offline`, async () => {
    const path = resolve('tests/traces', `${provider}.json`);
    const trace = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(trace.source, 'live-synthetic');
    assert.equal(trace.provider, provider);
    assert.ok(trace.cliVersion);
    const previous = process.env.ANNOTATE_MODEL_TRACE;
    let backend;
    if (provider === 'codex') {
      const home = join(root, 'codex-home');
      mkdirSync(home);
      const authSource = join(root, 'synthetic-auth.json');
      writeFileSync(authSource, '{}');
      writeFileSync(join(home, 'fixture-models.json'), JSON.stringify({ trace: path }));
      backend = new CodexBackend(resolve('tests/codex-fixture.cjs'), () => {}, {
        home,
        authSource,
      });
    } else {
      process.env.ANNOTATE_MODEL_TRACE = path;
      backend = new ClaudeBackend(
        resolve('tests/assistant-fixture.cjs'),
        'synthetic-model',
        () => {},
      );
    }
    try {
      await backend.enable();
      const id = await backend.session();
      let text = '';
      let completions = 0;
      const result = await new Promise((resolveDone, reject) => {
        void backend
          .ask(
            id,
            JSON.stringify(trace.request),
            (chunk) => {
              text += chunk;
            },
            (state, error) => {
              completions++;
              resolveDone({ state, error });
            },
          )
          .catch(reject);
      });
      assert.equal(result.state, 'completed', result.error);
      assert.match(text.trim(), /^orchid[.!]?$/i);
      assert.equal(completions, 1);
    } finally {
      backend.disable();
      if (previous === undefined) delete process.env.ANNOTATE_MODEL_TRACE;
      else process.env.ANNOTATE_MODEL_TRACE = previous;
    }
  });
}

test('trace projection removes accounts, paths and unrelated provider metadata', () => {
  const trace = modelTrace(
    'codex',
    [
      {
        direction: 'input',
        message: {
          method: 'turn/start',
          params: { input: [{ text: JSON.stringify(traceRequest) }], cwd: '/private/sentinel' },
        },
      },
      { direction: 'output', message: { result: { account: { token: 'secret-sentinel' } } } },
      {
        direction: 'output',
        message: {
          method: 'item/agentMessage/delta',
          params: { threadId: 'private-session', delta: 'orchid', ignored: 'secret-sentinel' },
        },
      },
      {
        direction: 'output',
        message: {
          method: 'turn/completed',
          params: { turn: { id: 'private-turn', status: 'completed', ignored: 'secret-sentinel' } },
        },
      },
    ],
    'synthetic-cli',
  );
  assert.doesNotMatch(JSON.stringify(trace), /sentinel|private-session|private-turn/);
  assert.equal(trace.events[0].params.threadId, 'trace-thread');
});

test('incomplete and non-synthetic traces cannot become replay fixtures', () => {
  assert.throws(() => modelTrace('codex', [], 'synthetic-cli'), /Missing synthetic request/);
  assert.throws(
    () =>
      modelTrace(
        'codex',
        [
          {
            direction: 'input',
            message: {
              method: 'turn/start',
              params: { input: [{ text: JSON.stringify({ noteText: 'personal note' }) }] },
            },
          },
        ],
        'synthetic-cli',
      ),
    /canonical synthetic/,
  );
  assert.throws(
    () =>
      modelTrace(
        'claude',
        [{ direction: 'output', message: { type: 'result', is_error: true } }],
        'synthetic-cli',
      ),
    /completed synthetic answer/,
  );
});

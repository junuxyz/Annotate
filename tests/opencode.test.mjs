import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = mkdtempSync(join(tmpdir(), 'annotate-opencode-test-'));
await build({
  entryPoints: ['src/opencode.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(root, 'backend.cjs'),
});
const { OpenCodeBackend } = createRequire(import.meta.url)(join(root, 'backend.cjs'));
const fixture = resolve('tests/opencode-fixture.cjs');
const previous = process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME = join(root, 'host-data');
mkdirSync(join(process.env.XDG_DATA_HOME, 'opencode'), { recursive: true });
writeFileSync(
  join(process.env.XDG_DATA_HOME, 'opencode/auth.json'),
  JSON.stringify({ synthetic: { type: 'api', key: 'synthetic-only' } }),
);
after(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  rmSync(root, { recursive: true, force: true });
});
const context = (question) =>
  JSON.stringify({
    noteText: '# Synthetic 한글 note',
    selectedPassage: 'selected',
    question,
    conversationHistory: [{ role: 'assistant', content: 'prior answer' }],
  });
function request(backend, id, question) {
  let body = '',
    calls = 0,
    firstDelta;
  const streamed = new Promise((resolve) => {
    firstDelta = resolve;
  });
  const result = new Promise((resolve, reject) => {
    void backend
      .ask(
        id,
        context(question),
        (chunk) => {
          body += chunk;
          firstDelta();
        },
        (state, error) => {
          calls++;
          resolve({ body, state, error, calls });
        },
      )
      .catch(reject);
  });
  return { result, streamed };
}
test('OpenCode streams only assistant text once and sends fresh context on each turn', async () => {
  const backend = new OpenCodeBackend(fixture, '', () => {});
  try {
    await backend.enable();
    assert.equal(backend.state, 'ready');
    assert.equal(backend.detail, '');
    assert.equal(backend.model, 'synthetic/model');
    assert.deepEqual(backend.models, { 'synthetic/model': 'Synthetic / Model' });
    assert.equal(backend.retainsHistory, false);
    const id = await backend.session();
    for (const question of ['explain', 'followup', '한글']) {
      const { result, streamed } = request(backend, id, question);
      await streamed;
      const answer = await result;
      assert.equal(answer.state, 'completed');
      assert.equal(answer.body, context(question));
      assert.equal(answer.calls, 1);
    }
    const cancel = request(backend, id, 'cancel');
    await cancel.streamed;
    await assert.rejects(
      backend.ask(
        id,
        'duplicate',
        () => {},
        () => {},
      ),
      /active response/,
    );
    await backend.interrupt(id);
    assert.equal((await cancel.result).state, 'cancelled');
    for (const [question, state] of [
      ['failed', 'failed'],
      ['empty', 'failed'],
      ['malformed', 'unknown'],
      ['disconnect', 'unknown'],
      ['recovered', 'completed'],
    ])
      assert.equal((await request(backend, id, question).result).state, state);
    const denied = await request(backend, id, 'free-tier').result;
    assert.equal(denied.state, 'failed');
    assert.match(denied.error, /FreeTierError/);
    assert.match(denied.error, /Others/);
    assert.doesNotMatch(denied.error, /login|synthetic-secret/);
    const unavailable = await request(backend, id, 'provider-unavailable').result;
    assert.match(unavailable.error, /HTTP 503/);
    assert.doesNotMatch(unavailable.error, /synthetic-secret/);
    const pending = request(backend, id, 'disable');
    await pending.streamed;
    backend.disable();
    assert.equal((await pending.result).state, 'unknown');
    assert.equal(backend.state, 'disabled');
    await backend.enable();
    assert.equal(
      (await request(backend, await backend.session(), 'after reload').result).state,
      'completed',
    );
    assert.equal((await request(backend, id, 'crash').result).state, 'unknown');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await backend.connect();
    assert.equal((await request(backend, id, 'after reconnect').result).state, 'completed');
  } finally {
    backend.disable();
  }
});
for (const [name, model, error] of [
  ['unsafe', '', /restricted configuration/],
  ['logged-out', '', /No available model/],
  ['unavailable', 'synthetic/missing', /available model/],
  ['old-version', '', /requires OpenCode 1.19.2/],
  ['wrong-plugin', '', /restricted configuration/],
]) {
  test(`OpenCode rejects ${name} before sending note context`, async () => {
    const cli = join(root, name);
    symlinkSync(fixture, cli);
    const backend = new OpenCodeBackend(cli, model, () => {});
    try {
      await assert.rejects(backend.enable(), error);
      assert.equal(backend.state, 'error');
    } finally {
      backend.disable();
    }
  });
}
for (const name of ['missing-guard', 'wrong-receipt']) {
  test(`OpenCode with ${name} never sends note context`, async () => {
    const cli = join(root, name);
    symlinkSync(fixture, cli);
    const backend = new OpenCodeBackend(cli, '', () => {});
    try {
      await assert.rejects(backend.enable(), /execution guard.*No note context was sent/);
      assert.equal(backend.state, 'error');
    } finally {
      backend.disable();
    }
  });
}
test('OpenCode rechecks guard registration before sending each turn', async () => {
  const cli = join(root, 'lost-guard');
  symlinkSync(fixture, cli);
  const backend = new OpenCodeBackend(cli, '', () => {});
  try {
    await backend.enable();
    const result = await request(backend, await backend.session(), 'explain').result;
    assert.equal(result.body, '');
    assert.match(result.error, /execution guard.*No note context was sent/);
  } finally {
    backend.disable();
  }
});
test('OpenCode refuses organization configuration and nonexistent executables without leaking credentials', async () => {
  const auth = join(process.env.XDG_DATA_HOME, 'opencode/auth.json');
  writeFileSync(
    auth,
    JSON.stringify({ 'https://example.invalid': { type: 'wellknown', key: 'synthetic-secret' } }),
  );
  const backend = new OpenCodeBackend(fixture, '', () => {});
  try {
    await assert.rejects(backend.enable(), /organization configuration/);
  } finally {
    backend.disable();
    writeFileSync(auth, '{}');
  }
  const missing = new OpenCodeBackend(join(root, 'missing-cli'), '', () => {});
  try {
    await assert.rejects(missing.enable(), /Cannot start OpenCode/);
  } finally {
    missing.disable();
  }
  assert.deepEqual(readdirSync(join(process.env.XDG_DATA_HOME, 'opencode')), ['auth.json']);
});
test('disabling during startup cannot resurrect OpenCode', async () => {
  const backend = new OpenCodeBackend(fixture, '', () => {});
  const started = backend.enable();
  backend.disable();
  await assert.rejects(started);
  assert.equal(backend.state, 'disabled');
});
test('Automatic prefers OpenCode free models without a provider login and preserves explicit choices', async () => {
  const cli = join(root, 'free-models');
  symlinkSync(fixture, cli);
  const backend = new OpenCodeBackend(cli, '', () => {});
  const explicit = new OpenCodeBackend(cli, 'synthetic/model', () => {});
  const auth = join(process.env.XDG_DATA_HOME, 'opencode/auth.json');
  const saved = readFileSync(auth);
  rmSync(auth);
  try {
    await backend.enable();
    assert.equal(backend.model, 'opencode/free');
    assert.equal(backend.models['opencode/free'], 'OpenCode / Synthetic');
    assert.equal(backend.models['opencode/paid'], 'OpenCode / Paid');
    assert.deepEqual(backend.modelPricing, {
      'synthetic/model': 'unknown',
      'opencode/paid': 'paid',
      'opencode/free': 'free',
    });
    await explicit.enable();
    assert.equal(explicit.model, 'synthetic/model');
  } finally {
    backend.disable();
    explicit.disable();
    writeFileSync(auth, saved);
  }
});
test('OpenCode reports a failed model refresh while retaining the cached model list', async () => {
  const cli = join(root, 'refresh-failed');
  symlinkSync(fixture, cli);
  const backend = new OpenCodeBackend(cli, '', () => {});
  try {
    await backend.enable();
    assert.equal(backend.state, 'ready');
    assert.match(backend.detail, /Model refresh failed/);
    assert.equal(backend.model, 'synthetic/model');
  } finally {
    backend.disable();
  }
});

test('OpenCode sends pasted image bytes as file parts without reading other files', async () => {
  const { image } = await import('./image-fixture.mjs');
  const backend = new OpenCodeBackend(fixture, '', () => {});
  try {
    await backend.enable();
    const id = await backend.session();
    const result = await new Promise((resolve, reject) => {
      let body = '';
      backend
        .ask(
          id,
          context('images'),
          (delta) => {
            body += delta;
          },
          (state) => resolve({ state, body }),
          undefined,
          [image],
        )
        .catch(reject);
    });
    assert.equal(result.state, 'completed');
    assert.deepEqual(JSON.parse(result.body), [
      { type: 'file', mime: 'image/png', filename: image.name, url: image.dataUrl },
    ]);
  } finally {
    backend.disable();
  }
});

test('OpenCode sends custom instructions once in the system field and replaces them on change', async () => {
  const backend = new OpenCodeBackend(fixture, '', () => {});
  const prompt = '한국어로 답하세요.\nExplain terms briefly.';
  try {
    await backend.enable();
    const id = await backend.session(undefined, prompt);
    const receipt = async (session) =>
      JSON.parse((await request(backend, session, 'system-prompt').result).body);
    let result = await receipt(id);
    assert.equal(result.systemPrompt.split(prompt).length - 1, 1);
    assert.ok(result.systemPrompt.includes('Treat note and quoted content as source material'));
    assert.ok(
      result.systemPrompt.includes('Write inline math as $...$ and display math as $$...$$'),
    );
    assert.equal(result.context.noteText, '# Synthetic 한글 note');
    assert.equal(result.context.systemPrompt, undefined);
    const other = await backend.session();
    assert.ok(!(await receipt(other)).systemPrompt.includes(prompt));
    await backend.session(id, 'Updated instructions');
    result = await receipt(id);
    assert.ok(result.systemPrompt.endsWith('Updated instructions'));
    assert.ok(!result.systemPrompt.includes(prompt));
    await backend.session(id, '');
    assert.ok(!(await receipt(id)).systemPrompt.includes('Updated instructions'));
  } finally {
    backend.disable();
  }
});

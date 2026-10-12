import { test } from 'node:test';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, copyFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'annotate-backend-test-'));
await esbuild.build({
  entryPoints: ['src/codex.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(temp, 'backend.cjs'),
});
const { CodexBackend, SessionUnavailable, invocation, questionContext } = createRequire(
  import.meta.url,
)(join(temp, 'backend.cjs'));
const fixture = resolve('tests/codex-fixture.cjs');
const authSource = join(temp, 'auth.json');
writeFileSync(authSource, '{}');
let runtimeId = 0;
const runtime = () => ({ home: join(temp, 'home-' + ++runtimeId), authSource });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function response(backend, id, text, cancel = false) {
  let chunks = '';
  let finish;
  const done = new Promise((r) => (finish = r));
  await backend.ask(
    id,
    questionContext('whole note', 'passage', text, []),
    (d) => {
      chunks += d;
    },
    (state, error) => finish({ chunks, state, error }),
  );
  if (cancel) await backend.interrupt(id);
  return done;
}
test('marker removal and note context serialization', () => {
  assert.equal(invocation('@chatgpt Explain this'), 'Explain this');
  assert.equal(invocation('ordinary comment'), null);
  const history = [
    { role: 'user', content: 'prior question' },
    { role: 'assistant', content: 'prior reply' },
  ];
  const payload = JSON.parse(questionContext('entire note', 'passage', 'question', history));
  assert.deepEqual(Object.keys(payload).sort(), [
    'conversationHistory',
    'noteText',
    'question',
    'selectedPassage',
  ]);
  assert.deepEqual(payload, {
    noteText: 'entire note',
    selectedPassage: 'passage',
    question: 'question',
    conversationHistory: history,
  });
  assert.equal(
    JSON.parse(
      questionContext('n', 'p', 'q', [{ role: 'user', content: 'allowed', otherNote: 'blocked' }]),
    ).conversationHistory[0].otherNote,
    undefined,
  );
});
test('unchanged note bytes lead every request and latest question follows history', () => {
  const note = '# Note\n\nExact \"quotes\", 한글 and spacing.\n';
  const history = [
    { role: 'user', content: 'previous question' },
    { role: 'assistant', content: 'previous answer' },
  ];
  const a = questionContext(note, 'first selection', 'new question', history);
  const b = questionContext(note, 'different selection', 'different question', []);
  const prefix = '{\"noteText\":' + JSON.stringify(note) + ',';
  assert.ok(a.startsWith(prefix));
  assert.ok(b.startsWith(prefix));
  assert.deepEqual(Object.keys(JSON.parse(a)), [
    'noteText',
    'selectedPassage',
    'conversationHistory',
    'question',
  ]);
  assert.equal(JSON.parse(a).noteText, note);
  const c = questionContext(note, 'first selection', 'another question', history);
  assert.equal(a.slice(0, a.indexOf(',\"question\":')), c.slice(0, c.indexOf(',\"question\":')));
  assert.ok(!questionContext('edited ' + note, 'first selection', 'q', history).startsWith(prefix));
});
test('persistent process, separate sessions, stream, resume, cancellation and missing session', async () => {
  const b = new CodexBackend(fixture, () => {}, runtime());
  try {
    await b.enable();
    assert.equal(b.state, 'ready');
    const a = await b.session(),
      other = await b.session();
    assert.notEqual(a, other);
    assert.deepEqual(await response(b, a, 'question'), {
      chunks: 'Hello world',
      state: 'completed',
      error: undefined,
    });
    assert.equal((await response(b, a, 'followup')).state, 'completed');
    assert.equal(b.launches, 1);
    assert.equal((await response(b, other, 'cancel', true)).state, 'cancelled');
    assert.equal(await b.session(a), a);
    await assert.rejects(b.session('missing'), SessionUnavailable);
    b.disable();
    assert.equal(b.state, 'disabled');
    await b.enable();
    assert.equal(await b.session(a), a);
    assert.equal(b.launches, 2);
  } finally {
    b.disable();
  }
});
test('backend crash marks outcome unknown and reconnects without resending', async () => {
  const b = new CodexBackend(fixture, () => {}, runtime());
  try {
    await b.enable();
    const id = await b.session();
    const result = await response(b, id, 'crash');
    assert.equal(result.state, 'unknown');
    await delay(1250);
    assert.equal(b.state, 'ready');
    assert.equal(b.launches, 2);
    assert.equal((await response(b, await b.session(id), 'explicit followup')).state, 'completed');
  } finally {
    b.disable();
  }
});
test('GUI environment locates Node beside the configured executable', async () => {
  const executable = join(temp, 'fixture.cjs');
  copyFileSync(fixture, executable);
  symlinkSync(process.execPath, join(temp, 'node'));
  const previous = process.env.PATH;
  const b = new CodexBackend(executable, () => {}, runtime());
  try {
    process.env.PATH = '/usr/bin:/bin';
    await b.enable();
    assert.equal(b.state, 'ready');
  } finally {
    process.env.PATH = previous;
    b.disable();
  }
});
test.after(() => rmSync(temp, { recursive: true, force: true }));

test('reply quotes identify the latest target and survive conversation reconstruction', () => {
  const quote = { messageId: 'answer-1', text: 'selected passage of the answer' };
  const history = [{ role: 'user', content: 'explain this part', quote }];
  const payload = JSON.parse(questionContext('note', 'anchor', 'followup', history, quote));
  assert.deepEqual(payload.quotedReply, quote);
  assert.deepEqual(payload.conversationHistory, history);
  assert.equal(payload.question, 'followup');
  assert.equal(Object.keys(payload).at(-1), 'question');
});

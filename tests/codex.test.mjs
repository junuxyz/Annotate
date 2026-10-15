import { test } from 'node:test';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  rmSync,
  copyFileSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
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
const { CodexBackend, SessionUnavailable, questionContext } = createRequire(import.meta.url)(
  join(temp, 'backend.cjs'),
);
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
test('note context serialization', () => {
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
  const note = '# Note\n\nExact "quotes", 한글 and spacing.\n';
  const history = [
    { role: 'user', content: 'previous question' },
    { role: 'assistant', content: 'previous answer' },
  ];
  const a = questionContext(note, 'first selection', 'new question', history);
  const b = questionContext(note, 'different selection', 'different question', []);
  const prefix = '{"noteText":' + JSON.stringify(note) + ',';
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
  assert.equal(a.slice(0, a.indexOf(',"question":')), c.slice(0, c.indexOf(',"question":')));
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

test('host tools dispatch only for active turns and receive cancellation context', async () => {
  let called = 0;
  const b = new CodexBackend(fixture, () => {}, runtime(), {
    tools: [
      {
        name: 'read_note',
        description: 'Read selected notes',
        inputSchema: { type: 'object' },
        async execute(args, context) {
          called++;
          assert.deepEqual(args, { path: 'Selected/note.md' });
          assert.equal(context.signal.aborted, false);
          assert.equal(context.callId, 'op-1');
          return 'host-note';
        },
      },
    ],
  });
  try {
    await b.enable();
    const result = await response(b, await b.session(), 'tools');
    assert.equal(result.state, 'completed');
    assert.equal(result.chunks, JSON.stringify('host-note'));
    assert.equal(called, 1);
  } finally {
    b.disable();
  }
});

test('native command approvals are denied and explicit model choices survive a stale catalog', async () => {
  const b = new CodexBackend(fixture, () => {}, runtime());
  b.preferredModel = 'account-model-not-in-stale-catalog';
  try {
    await b.enable();
    assert.equal(b.model, 'account-model-not-in-stale-catalog');
    const result = await response(b, await b.session(), 'approval');
    assert.equal(result.state, 'failed');
    assert.equal(result.chunks, 'rejected');
  } finally {
    b.disable();
  }
});

test('unavailable inherited CLI model falls back to the account default and completes a reply', async () => {
  const environment = runtime();
  mkdirSync(environment.home);
  const configPath = join(environment.home, 'fixture-models.json');
  const config = JSON.stringify({
    model: 'unavailable-cli-model',
    models: [
      { model: 'other-account-model', isDefault: false },
      { model: 'account-default', isDefault: true },
    ],
    rejectUnavailable: true,
  });
  writeFileSync(configPath, config);
  const b = new CodexBackend(fixture, () => {}, environment);
  try {
    await b.enable();
    assert.equal(b.model, 'account-default');
    assert.equal((await response(b, await b.session(), 'question')).state, 'completed');
    assert.equal(readFileSync(configPath, 'utf8'), config);
  } finally {
    b.disable();
  }
});

test('available inherited CLI model takes precedence over the account default', async () => {
  const environment = runtime();
  mkdirSync(environment.home);
  writeFileSync(
    join(environment.home, 'fixture-models.json'),
    JSON.stringify({
      model: 'chosen-cli-model',
      models: [
        { model: 'fixture-model', isDefault: true },
        { model: 'chosen-cli-model', isDefault: false },
      ],
      rejectUnavailable: true,
    }),
  );
  const b = new CodexBackend(fixture, () => {}, environment);
  try {
    await b.enable();
    assert.equal(b.model, 'chosen-cli-model');
    assert.equal((await response(b, await b.session(), 'question')).state, 'completed');
  } finally {
    b.disable();
  }
});

test('native skill discovery and explicit invocation cannot bypass note tools', async () => {
  const b = new CodexBackend(fixture, () => {}, runtime());
  try {
    await b.enable();
    assert.deepEqual(await b.listSkills(), []);
    await assert.rejects(
      b.ask(
        await b.session(),
        'question',
        () => {},
        () => {},
        {
          name: 'outside-skill',
          path: '/outside/SKILL.md',
          description: '',
          enabled: true,
        },
      ),
      /Native Codex skills are unavailable/,
    );
  } finally {
    b.disable();
  }
});

test('unregistered and stale dynamic calls cannot reach host tools', async () => {
  let calls = 0;
  const b = new CodexBackend(fixture, () => {}, runtime(), {
    tools: [
      {
        name: 'read_note',
        description: 'Read',
        inputSchema: { type: 'object' },
        async execute() {
          calls++;
          return 'unexpected';
        },
      },
    ],
  });
  try {
    await b.enable();
    for (const question of ['stale-tool', 'unknown-tool']) {
      const result = await response(b, await b.session(), question);
      assert.match(result.chunks, /unavailable|no longer active/);
    }
    assert.equal(calls, 0);
  } finally {
    b.disable();
  }
});

test('disable aborts a pending host request and never returns its result to another process', async () => {
  let entered;
  const started = new Promise((resolve) => (entered = resolve));
  let release;
  const approved = new Promise((resolve) => (release = resolve));
  let signal;
  const b = new CodexBackend(fixture, () => {}, runtime(), {
    tools: [
      {
        name: 'read_note',
        description: 'Read',
        inputSchema: { type: 'object' },
        async execute(_args, context) {
          signal = context.signal;
          entered();
          await approved;
          return 'late-result';
        },
      },
    ],
  });
  try {
    await b.enable();
    const result = response(b, await b.session(), 'pending-tool');
    await started;
    b.disable();
    assert.equal(signal.aborted, true);
    release();
    assert.equal((await result).state, 'unknown');
    await b.enable();
    assert.equal((await response(b, await b.session(), 'question')).chunks, 'Hello world');
  } finally {
    release();
    b.disable();
  }
});

test('unsupported or substituted permission profiles fail closed', async () => {
  for (const flag of ['unsupportedProfile', 'wrongProfile']) {
    const environment = runtime();
    mkdirSync(environment.home);
    writeFileSync(join(environment.home, 'fixture-models.json'), JSON.stringify({ [flag]: true }));
    const b = new CodexBackend(fixture, () => {}, environment);
    try {
      if (flag === 'unsupportedProfile')
        await assert.rejects(b.enable(), /cannot enforce Annotate note boundaries/);
      else {
        await b.enable();
        await assert.rejects(b.session());
      }
    } finally {
      b.disable();
    }
  }
});

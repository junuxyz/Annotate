#!/usr/bin/env node
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const refreshing = args[0] === 'models';
assert.deepEqual(
  args,
  refreshing
    ? ['models', '--refresh', '--pure']
    : ['serve', '--hostname', '127.0.0.1', '--port', '0'],
);
assert.equal(process.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
assert.equal(process.env.OPENCODE_DISABLE_CLAUDE_CODE, '1');
assert.equal(process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS, '1');
for (const key of [
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY',
  'BUN_OPTIONS',
  'NODE_OPTIONS',
])
  assert.ok(!Object.hasOwn(process.env, key));
assert.equal(process.env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
assert.ok(fs.realpathSync(process.env.XDG_CONFIG_HOME).startsWith(process.cwd()));
assert.ok(fs.realpathSync(process.env.XDG_DATA_HOME).startsWith(process.cwd()));
assert.equal(fs.existsSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode/AGENTS.md')), false);
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
assert.deepEqual(config.permission, { '*': 'ask' });
assert.deepEqual(config.agent.annotate.permission, { '*': 'ask' });
assert.deepEqual(config.mcp, {});
assert.equal(config.plugin.length, 1);
assert.equal(config.share, 'disabled');
const variant = path.basename(process.argv[1]);
if (refreshing) {
  assert.equal(fs.existsSync(path.join(process.env.XDG_DATA_HOME, 'opencode/auth.json')), false);
  fs.writeFileSync(
    path.join(process.env.XDG_STATE_HOME, 'opencode/catalogue-lock'),
    'synthetic stale lock',
  );
  if (!variant.includes('refresh-failed'))
    fs.writeFileSync(path.join(process.env.XDG_CACHE_HOME, 'opencode/models.json'), 'synthetic');
  process.exit(variant.includes('refresh-failed') ? 1 : 0);
}
assert.equal(
  fs.existsSync(path.join(process.env.XDG_STATE_HOME, 'opencode/catalogue-lock')),
  false,
  'Catalogue locks must not block the response server',
);
assert.ok(
  variant.includes('refresh-failed') ||
    fs.existsSync(path.join(process.env.XDG_CACHE_HOME, 'opencode/models.json')),
);
const streams = new Set();
const hooks = variant.includes('missing-guard')
  ? null
  : import(config.plugin[0]).then((m) => m.AnnotateGuard());
let count = 0;
const emit = (type, properties) => {
  const value = `data: ${JSON.stringify({ type, properties })}\n\n`;
  for (const stream of streams) {
    // Exercise UTF-8 decoding and arbitrary SSE chunk boundaries.
    const bytes = Buffer.from(value);
    stream.write(bytes.subarray(0, bytes.length - 4));
    stream.write(bytes.subarray(bytes.length - 4));
  }
};
const server = http.createServer(async (req, res) => {
  assert.equal(
    req.headers.authorization,
    `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`,
  );
  const json = (value) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value));
  };
  if (req.url === '/global/health')
    return json({ healthy: true, version: variant.includes('old-version') ? '1.14.21' : '1.19.2' });
  if (req.url === '/config') {
    if (variant.includes('unsafe')) config.permission.read = 'allow';
    if (variant.includes('wrong-plugin')) config.plugin = ['file:///not-the-guard.mjs'];
    return json(config);
  }
  if (req.url === '/provider')
    return json({
      connected: variant.includes('logged-out')
        ? []
        : variant.includes('free-models')
          ? ['synthetic', 'opencode']
          : ['synthetic'],
      default: { synthetic: 'model', opencode: 'paid' },
      all: [
        { id: 'synthetic', name: 'Synthetic', models: { model: { name: 'Model' } } },
        ...(variant.includes('free-models')
          ? [
              {
                id: 'opencode',
                name: 'OpenCode',
                models: {
                  ...(variant.includes('featured')
                    ? {
                        'deepseek-v4.1-flash-free': {
                          name: 'DeepSeek V4.1 Flash Free',
                          cost: { input: 0, output: 0 },
                        },
                        'glm-5.3-flash-free': {
                          name: 'GLM 5.3 Flash Free',
                          cost: { input: 0, output: 0 },
                        },
                      }
                    : {}),
                  paid: { name: 'Paid', cost: { input: 1, output: 2 } },
                  free: { name: 'Synthetic', cost: { input: 0, output: 0 } },
                },
              },
            ]
          : []),
        { id: 'unconnected', name: 'Unconnected', models: { hidden: { name: 'Hidden' } } },
      ],
    });
  if (req.url === '/event') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = body ? JSON.parse(body) : null;
  if (req.url === '/session') {
    assert.deepEqual(payload.permission, [{ permission: '*', pattern: '*', action: 'ask' }]);
    const id = `ses_${++count}`;
    if (hooks && !(variant.includes('lost-guard') && count > 1))
      await (
        await hooks
      ).event({ event: { type: 'session.created', properties: { info: { id } } } });
    if (variant.includes('wrong-receipt'))
      fs.writeFileSync(path.join(process.cwd(), 'guard', id), 'wrong-token');
    return json({ id });
  }
  if (req.url.endsWith('/abort')) return json(true);
  assert.ok(req.url.endsWith('/prompt_async'));
  assert.ok(
    !variant.includes('missing-guard') &&
      !variant.includes('wrong-receipt') &&
      !variant.includes('lost-guard'),
    'No context may be sent without guard verification',
  );
  assert.equal(payload.agent, 'annotate');
  assert.deepEqual(payload.model, { providerID: 'synthetic', modelID: 'model' });
  const sessionID = req.url.split('/')[2];
  const text = payload.parts[0].text;
  const context = JSON.parse(text.slice(text.indexOf('{')));
  const question = context.question;
  const answer = JSON.stringify(question === 'images' ? payload.parts.slice(1) : context);
  res.writeHead(204).end();
  const message = (id, role) => emit('message.updated', { info: { id, sessionID, role } });
  const part = (id, messageID, type, text) =>
    emit('message.part.updated', { part: { id, messageID, sessionID, type, text } });
  message('user', 'user');
  part('input', 'user', 'text', 'NEVER DISPLAY THE USER INPUT');
  message('assistant', 'assistant');
  part('reason', 'assistant', 'reasoning', 'NEVER DISPLAY REASONING');
  emit('message.part.delta', {
    sessionID,
    messageID: 'assistant',
    partID: 'reason',
    field: 'text',
    delta: 'hidden',
  });
  emit('message.part.updated', {
    part: {
      id: 'foreign',
      sessionID: 'another',
      messageID: 'assistant',
      type: 'text',
      text: 'NEVER DISPLAY OTHER SESSIONS',
    },
  });
  if (question === 'malformed') {
    for (const stream of streams) stream.write('data: not JSON\n\n');
    return;
  }
  if (question === 'free-tier' || question === 'provider-unavailable') {
    emit('session.error', {
      sessionID,
      error: {
        name: 'APIError',
        data: {
          message:
            question === 'free-tier'
              ? "OpenCode's free tier can only be used from within OpenCode."
              : 'Synthetic provider unavailable',
          statusCode: question === 'free-tier' ? 403 : 503,
          responseBody: JSON.stringify({
            error: { type: question === 'free-tier' ? 'FreeTierError' : 'SyntheticError' },
          }),
          requestBodyValues: { private: 'synthetic-secret-not-for-display' },
        },
      },
    });
    return;
  }
  if (question === 'failed') {
    emit('session.error', { sessionID, error: { name: 'SyntheticError' } });
    return;
  }
  if (question === 'empty') {
    emit('session.status', { sessionID, status: { type: 'idle' } });
    return;
  }
  part('text', 'assistant', 'text', '');
  emit('message.part.delta', {
    sessionID,
    messageID: 'assistant',
    partID: 'text',
    field: 'text',
    delta: answer.slice(0, 15),
  });
  if (question === 'crash') {
    process.exit(1);
  }
  if (question === 'disconnect') {
    for (const stream of streams) stream.end();
    return;
  }
  setTimeout(() => {
    if (question === 'cancel' || question === 'disable') return;
    emit('message.part.delta', {
      sessionID,
      messageID: 'assistant',
      partID: 'text',
      field: 'text',
      delta: answer.slice(15),
    });
    part('text', 'assistant', 'text', answer);
    emit('session.status', { sessionID, status: { type: 'idle' } });
  }, 80);
});
server.listen(0, '127.0.0.1', () =>
  console.log(`opencode server listening on http://127.0.0.1:${server.address().port}`),
);

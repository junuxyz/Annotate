#!/usr/bin/env node
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const emit = (event, newline = true) =>
  process.stdout.write(JSON.stringify(event) + (newline ? '\n' : ''));
assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
assert.equal(process.env.XAI_API_KEY, undefined);
assert.equal(process.env.CLAUDE_CODE_SAFE_MODE, '1');
if (args[0] === 'auth') {
  emit({
    loggedIn: true,
    authMethod: process.argv[1].includes('api-login') ? 'api_key' : 'claude.ai',
  });
} else {
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (text += chunk));
  process.stdin.on('end', () => {
    const payload = JSON.parse(text.slice(text.indexOf('{')));
    if (process.env.ANNOTATE_MODEL_TRACE) {
      const trace = JSON.parse(
        require('node:fs').readFileSync(process.env.ANNOTATE_MODEL_TRACE, 'utf8'),
      );
      assert.equal(trace.source, 'live-synthetic');
      assert.deepEqual(payload, trace.request);
      for (const [index, event] of trace.events.entries())
        emit(event, index < trace.events.length - 1);
      return;
    }
    const answer = JSON.stringify(payload);
    const delta = (text) =>
      emit({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
      });
    if (payload.question === 'malformed') {
      process.stdout.write('not JSON\n');
      return;
    }
    if (payload.question === 'failed') {
      emit({ type: 'result', is_error: true });
      return;
    }
    delta(answer.slice(0, 15));
    if (payload.question === 'crash') {
      process.exitCode = 1;
      return;
    }
    setTimeout(
      () => {
        delta(answer.slice(15));
        emit({ type: 'result', is_error: false, result: answer }, false);
      },
      payload.question === 'cancel' ? 5000 : 80,
    );
  });
}

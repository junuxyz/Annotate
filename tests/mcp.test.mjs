import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const directory = await mkdtemp(join(tmpdir(), 'annotate-mcp-test-'));
after(() => rm(directory, { recursive: true, force: true }));
await build({
  entryPoints: ['src/mcp.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(directory, 'mcp.cjs'),
});
const require = createRequire(import.meta.url);
const { McpServices, mcpServiceSchema, requestMcp } = require(join(directory, 'mcp.cjs'));
const service = () => ({
  id: 'notes',
  name: 'Selected service',
  url: 'https://mcp.example/tools',
  enabled: true,
});
const context = () => ({
  threadId: 'thread',
  turnId: 'turn',
  callId: 'call',
  signal: new AbortController().signal,
});
function fixture({
  eventStream = false,
  services = [service()],
  approve = async () => true,
  handle,
} = {}) {
  const requests = [],
    approvals = [];
  const options = {
    services: () => services,
    approve: async (request) => {
      approvals.push(request);
      return approve(request);
    },
    request: async (request) => {
      const body = JSON.parse(request.body);
      requests.push({ ...request, rpc: body });
      const overridden = await handle?.(request, body);
      if (overridden) return overridden;
      const headers = { 'Content-Type': eventStream ? 'text/event-stream' : 'application/json' };
      let result;
      if (body.method === 'initialize') {
        result = {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'test', version: '1' },
        };
        headers['Mcp-Session-Id'] = 'opaque-session';
      } else if (body.method === 'notifications/initialized')
        return { status: 202, headers: {}, text: '' };
      else if (body.method === 'tools/list')
        result = {
          tools: [
            {
              name: 'send_message',
              description: 'Sends a message',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        };
      else result = { content: [{ type: 'text', text: 'sent' }] };
      const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
      return {
        status: 200,
        headers,
        text: eventStream
          ? `event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\r\n\r\nevent: message\r\ndata: ${message}\r\n\r\n`
          : message,
      };
    },
  };
  return { client: new McpServices(options), requests, approvals, services };
}

for (const eventStream of [false, true]) {
  test(`MCP ${eventStream ? 'SSE' : 'JSON'} lifecycle discovers only enabled tools and approves exact calls`, async () => {
    const { client, requests, approvals } = fixture({ eventStream });
    const tools = await client.tools();
    assert.equal(tools.length, 1);
    assert.match(tools[0].name, /^mcp_notes_send_message_[a-f0-9]{16}$/);
    assert.deepEqual(
      requests.map(({ rpc }) => rpc.method),
      ['initialize', 'notifications/initialized', 'tools/list'],
    );
    assert.equal(
      approvals.length,
      0,
      'discovery sends no note content and needs no per-call approval',
    );
    assert.deepEqual(requests[0].rpc.params.capabilities, {});
    for (const request of requests.slice(1)) {
      assert.equal(request.headers['Mcp-Session-Id'], 'opaque-session');
      assert.equal(request.headers['MCP-Protocol-Version'], '2025-06-18');
    }
    const args = { text: 'A synthetic note', recipients: ['example'] };
    assert.deepEqual(await tools[0].execute(args, context()), {
      content: [{ type: 'text', text: 'sent' }],
    });
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].serviceName, service().name);
    assert.equal(approvals[0].url, service().url);
    assert.equal(approvals[0].toolName, 'send_message');
    assert.deepEqual(JSON.parse(approvals[0].argumentsJson), args);
    assert.deepEqual(requests.at(-1).rpc.params, { name: 'send_message', arguments: args });
    await tools[0].execute(args, context());
    assert.equal(approvals.length, 2, 'approval is required every time, even for the same tool');
    assert.deepEqual(
      (await client.tools()).map(({ name }) => name),
      tools.map(({ name }) => name),
    );
  });
}

test('disabled services cause no network traffic, and endpoints cannot embed credentials or use HTTP', async () => {
  const { client, requests } = fixture({ services: [{ ...service(), enabled: false }] });
  assert.deepEqual(await client.tools(), []);
  assert.equal(requests.length, 0);
  for (const url of [
    'http://mcp.example/tools',
    'https://user:secret@mcp.example/tools',
    'file:///tmp/mcp',
    'https://mcp.example/tools#fragment',
  ])
    assert.equal(mcpServiceSchema.safeParse({ ...service(), url }).success, false);
});

test('denied, cancelled, and changed-service approvals never dispatch arguments', async () => {
  for (const action of ['deny', 'cancel', 'disable', 'change']) {
    const controller = new AbortController();
    const item = fixture({
      approve: async () => {
        if (action === 'cancel') controller.abort();
        if (action === 'disable') item.services[0].enabled = false;
        if (action === 'change') item.services[0].url = 'https://other.example/tools';
        return action !== 'deny';
      },
    });
    const [tool] = await item.client.tools();
    await assert.rejects(
      tool.execute({ text: 'private' }, { ...context(), signal: controller.signal }),
      /denied|cancelled|disabled or changed/,
    );
    assert.equal(item.requests.filter(({ rpc }) => rpc.method === 'tools/call').length, 0, action);
  }
});

test('service is rechecked after asynchronous discovery and before each call', async () => {
  const item = fixture({
    handle: async (_request, body) => {
      if (body.method === 'tools/list') item.services[0].enabled = false;
    },
  });
  await assert.rejects(item.client.tools(), /disabled or changed/);
  const next = fixture();
  const [tool] = await next.client.tools();
  next.services[0].enabled = false;
  await assert.rejects(tool.execute({ text: 'private' }, context()), /disabled or changed/);
  assert.equal(next.approvals.length, 0);
});

test('call arguments cannot change while approval is pending', async () => {
  const args = { text: 'approved preview' };
  const item = fixture({
    approve: async (request) => {
      args.text = 'changed by caller';
      request.arguments.text = 'changed by UI';
      return true;
    },
  });
  const [tool] = await item.client.tools();
  await tool.execute(args, context());
  assert.equal(item.requests.at(-1).rpc.params.arguments.text, 'approved preview');
});

test('server failures after dispatch report unknown outcome without retrying a mutation', async () => {
  for (const status of [307, 308, 404, 500]) {
    const item = fixture({
      handle: async (_request, body) =>
        body.method === 'tools/call'
          ? { status, headers: { location: 'https://other.example' }, text: '' }
          : undefined,
    });
    const [tool] = await item.client.tools();
    await assert.rejects(
      tool.execute({ text: 'private' }, context()),
      /outcome is unknown.*not retried/,
    );
    assert.equal(item.requests.filter(({ rpc }) => rpc.method === 'tools/call').length, 1);
  }
});

test('malformed sessions, tools, oversized output and JSON-RPC errors fail closed', async () => {
  const mutations = [
    (body) =>
      body.method === 'initialize'
        ? {
            status: 200,
            headers: { 'content-type': 'application/json', 'mcp-session-id': 'bad\nheader' },
            text: JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { protocolVersion: '2025-06-18', capabilities: {} },
            }),
          }
        : undefined,
    (body) =>
      body.method === 'tools/list'
        ? {
            status: 200,
            headers: { 'content-type': 'application/json' },
            text: JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { tools: [{ name: 'bad tool', inputSchema: {} }] },
            }),
          }
        : undefined,
    (body) =>
      body.method === 'tools/list'
        ? {
            status: 200,
            headers: { 'content-type': 'application/json' },
            text: JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              error: { code: -32603, message: 'List failed' },
            }),
          }
        : undefined,
    () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: 'x'.repeat(1024 * 1024 + 1),
    }),
  ];
  for (const mutate of mutations) {
    const item = fixture({ handle: async (_request, body) => mutate(body) });
    await assert.rejects(item.client.tools());
    assert.equal(
      item.requests.some(({ rpc }) => rpc.method === 'tools/call'),
      false,
    );
  }
});

test('services with overlapping tool names get distinct stable prefixed names', async () => {
  const item = fixture({
    services: [service(), { ...service(), id: 'other', name: 'Other service' }],
  });
  const tools = await item.client.tools();
  assert.equal(new Set(tools.map(({ name }) => name)).size, 2);
  assert.deepEqual(
    (await item.client.tools()).map(({ name }) => name),
    tools.map(({ name }) => name),
  );
});

test('HTTPS transport rejects redirects without following them and keeps certificate verification enabled', async () => {
  const https = require('node:https');
  const original = https.request;
  try {
    for (const status of [301, 302, 303, 307, 308]) {
      let count = 0;
      https.request = (_url, options, response) => {
        count++;
        assert.equal(options.agent, false);
        assert.equal(options.rejectUnauthorized, true);
        const outgoing = new EventEmitter();
        outgoing.end = () => {
          const incoming = new EventEmitter();
          incoming.statusCode = status;
          incoming.headers = { location: 'https://different.example/leak' };
          incoming.destroy = () => {};
          response(incoming);
        };
        outgoing.destroy = (error) => outgoing.emit('error', error);
        return outgoing;
      };
      await assert.rejects(
        requestMcp({ url: service().url, headers: {}, body: '{}' }),
        /redirects are blocked/,
      );
      assert.equal(count, 1);
    }
  } finally {
    https.request = original;
  }
});

test('cancellation dismisses a pending approval without waiting for a UI response', async () => {
  const controller = new AbortController();
  let approvalStarted;
  const started = new Promise((resolve) => (approvalStarted = resolve));
  let finishApproval;
  const item = fixture({
    approve: () => {
      approvalStarted();
      return new Promise((resolve) => (finishApproval = resolve));
    },
  });
  const [tool] = await item.client.tools();
  const pending = tool.execute({ text: 'private' }, { ...context(), signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  finishApproval(true);
  await Promise.resolve();
  assert.equal(
    item.requests.some(({ rpc }) => rpc.method === 'tools/call'),
    false,
  );
});

test('tool list pagination preserves opaque cursors and refuses duplicate tools', async () => {
  let page = 0;
  const item = fixture({
    handle: async (_request, body) => {
      if (body.method !== 'tools/list') return;
      if (page++) assert.deepEqual(body.params, { cursor: 'opaque-next' });
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        text: JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: page === 1 ? 'first.tool' : 'second', inputSchema: { type: 'object' } },
            ],
            ...(page === 1 ? { nextCursor: 'opaque-next' } : {}),
          },
        }),
      };
    },
  });
  const tools = await item.client.tools();
  assert.equal(tools.length, 2);
  assert.match(tools[0].name, /^[a-zA-Z0-9_-]+$/);
  const duplicate = fixture({
    handle: async (_request, body) =>
      body.method === 'tools/list'
        ? {
            status: 200,
            headers: { 'content-type': 'application/json' },
            text: JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                tools: [
                  { name: 'same', inputSchema: { type: 'object' } },
                  { name: 'same', inputSchema: { type: 'object' } },
                ],
              },
            }),
          }
        : undefined,
  });
  await assert.rejects(duplicate.client.tools(), /duplicate tool names/);
});

test('HTTPS transport aborts an in-flight request without retrying it', async () => {
  const https = require('node:https');
  const original = https.request;
  const controller = new AbortController();
  let count = 0;
  let destroyed = 0;
  try {
    https.request = () => {
      count++;
      const outgoing = new EventEmitter();
      outgoing.end = () => {};
      outgoing.destroy = (error) => {
        destroyed++;
        outgoing.emit('error', error);
      };
      return outgoing;
    };
    const pending = requestMcp({
      url: service().url,
      headers: {},
      body: '{}',
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, /cancelled/);
    assert.equal(count, 1);
    assert.equal(destroyed, 1);
  } finally {
    https.request = original;
  }
});

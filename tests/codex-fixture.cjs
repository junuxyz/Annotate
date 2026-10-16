#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const modelConfigPath = path.join(process.env.CODEX_HOME, 'fixture-models.json');
const modelConfig = fs.existsSync(modelConfigPath)
  ? JSON.parse(fs.readFileSync(modelConfigPath, 'utf8'))
  : {};
const models = modelConfig.models ?? [{ model: 'fixture-model', isDefault: true }];
let session = 0,
  skillsDisabled = false;
const timers = new Map();
const approvals = new Map();
const toolCalls = new Map();
const sessionTools = new Map();
const send = (x) => process.stdout.write(JSON.stringify(x) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.id) return;
  if (!m.method && toolCalls.has(m.id)) {
    const { id, turnId } = toolCalls.get(m.id);
    toolCalls.delete(m.id);
    send({
      method: 'item/agentMessage/delta',
      params: {
        threadId: id,
        turnId,
        itemId: 'answer',
        delta: m.result?.contentItems?.[0]?.text ?? 'missing-output',
      },
    });
    send({
      method: 'turn/completed',
      params: { threadId: id, turn: { id: turnId, status: 'completed' } },
    });
    return;
  }
  if (!m.method && approvals.has(m.id)) {
    const { id, turnId } = approvals.get(m.id);
    approvals.delete(m.id);
    const accepted = m.result?.decision === 'accept';
    send({
      method: 'item/agentMessage/delta',
      params: { threadId: id, turnId, itemId: 'answer', delta: accepted ? 'approved' : 'rejected' },
    });
    send({
      method: 'turn/completed',
      params: { threadId: id, turn: { id: turnId, status: accepted ? 'completed' : 'failed' } },
    });
    return;
  }
  const reply = (result) => send({ id: m.id, result });
  if (m.method === 'initialize') reply({});
  else if (m.method === 'permissionProfile/list')
    reply({ data: [{ id: 'annotate', allowed: !modelConfig.unsupportedProfile }] });
  else if (m.method === 'config/read')
    reply({
      config: {
        model: modelConfig.model ?? null,
        features: { shell_tool: false, unified_exec: false },
        mcp_servers: {},
        permissions: {
          annotate: {
            filesystem: { ':root': 'deny', [process.cwd()]: 'read' },
            network: { enabled: false },
          },
        },
      },
    });
  else if (m.method === 'account/read') reply({ account: { type: 'chatgpt' } });
  else if (m.method === 'skills/list')
    reply({
      data: [
        {
          skills: [
            {
              name: 'synthetic-review',
              description: 'Review the synthetic passage',
              path: '/fake/global-skill/SKILL.md',
              enabled: !skillsDisabled,
            },
          ],
        },
      ],
    });
  else if (m.method === 'skills/config/write') {
    skillsDisabled = true;
    reply({});
  } else if (m.method === 'model/list') reply({ data: models });
  else if (
    m.method === 'thread/start' &&
    modelConfig.rejectUnavailable &&
    !models.some((model) => model.model === m.params.model)
  )
    send({ id: m.id, error: { message: 'Model is unavailable for this account' } });
  else if (m.method === 'thread/start') {
    if (
      m.params.permissions !== 'annotate' ||
      m.params.sandbox ||
      m.params.approvalPolicy !== 'on-request'
    )
      throw new Error('Unsafe thread');
    const id = 'session-' + ++session;
    sessionTools.set(id, m.params.dynamicTools);
    reply({
      thread: { id },
      activePermissionProfile: { id: modelConfig.wrongProfile ? ':workspace' : 'annotate' },
    });
  } else if (m.method === 'thread/resume')
    m.params.threadId === 'missing'
      ? send({ id: m.id, error: { message: 'not found' } })
      : reply({
          thread: { id: m.params.threadId },
          activePermissionProfile: { id: modelConfig.wrongProfile ? ':workspace' : 'annotate' },
        });
  else if (
    m.method === 'turn/start' &&
    (m.params.permissions !== 'annotate' ||
      m.params.sandboxPolicy ||
      m.params.approvalPolicy !== 'on-request')
  )
    send({ id: m.id, error: { message: 'Web access is disabled' } });
  else if (
    m.method === 'turn/start' &&
    ![
      'noteText,selectedPassage,conversationHistory,question',
      'noteText,selectedPassage,conversationHistory,quotedReply,question',
    ].includes(Object.keys(JSON.parse(m.params.input[0].text)).join(','))
  )
    send({ id: m.id, error: { message: 'Context order is not canonical' } });
  else if (m.method === 'turn/start') {
    const id = m.params.threadId,
      turnId = 'turn-' + m.id;
    if (JSON.parse(m.params.input[0].text).question === 'failed-start-tool') {
      send({
        method: 'turn/started',
        params: { threadId: id, turn: { id: turnId, status: 'inProgress' } },
      });
      const requestId = 'host-' + turnId;
      toolCalls.set(requestId, { id, turnId });
      send({
        id: requestId,
        method: 'item/tool/call',
        params: {
          threadId: id,
          turnId,
          callId: 'op-failed',
          tool: sessionTools.get(id)[0].name,
          arguments: { path: 'Selected/note.md' },
        },
      });
      setTimeout(() => send({ id: m.id, error: { message: 'Synthetic turn start failed' } }), 25);
      return;
    }
    reply({ turn: { id: turnId } });
    send({
      method: 'turn/started',
      params: { threadId: id, turn: { id: turnId, status: 'inProgress' } },
    });
    if (modelConfig.trace) {
      const trace = JSON.parse(fs.readFileSync(modelConfig.trace, 'utf8'));
      assert.equal(trace.source, 'live-synthetic');
      assert.deepEqual(JSON.parse(m.params.input[0].text), trace.request);
      for (const event of trace.events) {
        const params = { ...event.params, threadId: id };
        if (event.method === 'turn/completed') params.turn = { ...params.turn, id: turnId };
        else params.turnId = turnId;
        send({ method: event.method, params });
      }
      return;
    }
    const skill = m.params.input.find((input) => input.type === 'skill');
    if (skill) {
      const valid =
        skill.name === 'synthetic-review' && skill.path === '/fake/global-skill/SKILL.md';
      send({
        method: 'item/agentMessage/delta',
        params: {
          threadId: id,
          turnId,
          itemId: 'answer',
          delta: valid ? 'skill-input-verified' : 'wrong-skill',
        },
      });
      send({
        method: 'turn/completed',
        params: { threadId: id, turn: { id: turnId, status: valid ? 'completed' : 'failed' } },
      });
      return;
    }
    if (JSON.parse(m.params.input[0].text).question === 'approval') {
      const requestId = 'approval-' + turnId;
      approvals.set(requestId, { id, turnId });
      send({
        id: requestId,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: id, turnId, itemId: 'command' },
      });
      return;
    }
    if (
      ['tools', 'stale-tool', 'unknown-tool', 'pending-tool'].includes(
        JSON.parse(m.params.input[0].text).question,
      )
    ) {
      const requestId = 'host-' + turnId;
      toolCalls.set(requestId, { id, turnId });
      const tool = sessionTools.get(id)?.[0];
      if (!tool) throw new Error('Missing host tool');
      send({
        id: requestId,
        method: 'item/tool/call',
        params: {
          threadId: id,
          turnId:
            JSON.parse(m.params.input[0].text).question === 'stale-tool' ? 'stale-turn' : turnId,
          callId: 'op-1',
          tool:
            JSON.parse(m.params.input[0].text).question === 'unknown-tool'
              ? 'unregistered'
              : tool.name,
          arguments: { path: 'Selected/note.md' },
        },
      });
      return;
    }
    if (JSON.parse(m.params.input[0].text).question === 'crash') {
      setTimeout(() => process.exit(1), 20);
      return;
    }
    let i = 0;
    const timer = setInterval(() => {
      send({
        method: 'item/agentMessage/delta',
        params: { threadId: id, turnId, itemId: 'answer', delta: ['Hello', ' world'][i++] },
      });
      if (i === 2) {
        clearInterval(timer);
        timers.delete(id);
        send({
          method: 'turn/completed',
          params: { threadId: id, turn: { id: turnId, status: 'completed' } },
        });
      }
    }, 40);
    timers.set(id, { timer, turnId });
  } else if (m.method === 'turn/interrupt') {
    const t = timers.get(m.params.threadId);
    if (t) clearInterval(t.timer);
    timers.delete(m.params.threadId);
    reply({});
    send({
      method: 'turn/completed',
      params: { threadId: m.params.threadId, turn: { id: m.params.turnId, status: 'interrupted' } },
    });
  }
});

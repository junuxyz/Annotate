#!/usr/bin/env node
const readline = require('node:readline');
let session = 0,
  skillsDisabled = false;
const timers = new Map();
const approvals = new Map();
const send = (x) => process.stdout.write(JSON.stringify(x) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.id) return;
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
  else if (m.method === 'config/read') reply({ config: { model: null } });
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
  } else if (m.method === 'model/list')
    reply({ data: [{ model: 'fixture-model', isDefault: true }] });
  else if (m.method === 'thread/start') reply({ thread: { id: 'session-' + ++session } });
  else if (m.method === 'thread/resume')
    m.params.threadId === 'missing'
      ? send({ id: m.id, error: { message: 'not found' } })
      : reply({ thread: { id: m.params.threadId } });
  else if (
    m.method === 'turn/start' &&
    !['readOnly', 'dangerFullAccess'].includes(m.params.sandboxPolicy?.type)
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
    reply({ turn: { id: turnId } });
    send({
      method: 'turn/started',
      params: { threadId: id, turn: { id: turnId, status: 'inProgress' } },
    });
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
    if (JSON.parse(m.params.input[0].text).question === 'tools') {
      if (m.params.sandboxPolicy?.type !== 'dangerFullAccess') {
        send({
          method: 'turn/completed',
          params: {
            threadId: id,
            turn: {
              id: turnId,
              status: 'failed',
              error: { message: 'Terminal tools are restricted' },
            },
          },
        });
        return;
      }
      send({
        method: 'item/started',
        params: { threadId: id, turnId, item: { id: 'terminal', type: 'commandExecution' } },
      });
      const token = require('node:child_process')
        .execFileSync(process.execPath, ['-e', 'process.stdout.write("terminal-executed")'])
        .toString();
      send({
        method: 'item/completed',
        params: { threadId: id, turnId, item: { id: 'terminal', type: 'commandExecution' } },
      });
      send({
        method: 'item/started',
        params: { threadId: id, turnId, item: { id: 'search', type: 'webSearch' } },
      });
      send({
        method: 'item/completed',
        params: { threadId: id, turnId, item: { id: 'search', type: 'webSearch' } },
      });
      send({
        method: 'item/agentMessage/delta',
        params: { threadId: id, turnId, itemId: 'answer', delta: token },
      });
      send({
        method: 'turn/completed',
        params: { threadId: id, turn: { id: turnId, status: 'completed' } },
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

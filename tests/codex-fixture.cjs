#!/usr/bin/env node
const readline = require('node:readline');
let session = 0,
  skillsDisabled = false;
const timers = new Map();
const send = (x) => process.stdout.write(JSON.stringify(x) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.id) return;
  const reply = (result) => send({ id: m.id, result });
  if (m.method === 'initialize') reply({});
  else if (m.method === 'account/read') reply({ account: { type: 'chatgpt' } });
  else if (m.method === 'skills/list')
    reply({
      data: [{ skills: [{ path: '/fake/global-skill/SKILL.md', enabled: !skillsDisabled }] }],
    });
  else if (m.method === 'skills/config/write') {
    skillsDisabled = true;
    reply({});
  } else if (m.method === 'model/list')
    reply({ data: [{ model: 'fixture-model', isDefault: true }] });
  else if (
    m.method === 'thread/start' &&
    (!m.params.config?.['skills.config']?.every((s) => s.enabled === false) ||
      m.params.config?.['project_doc_max_bytes'] !== 0)
  )
    send({ id: m.id, error: { message: 'Isolation missing' } });
  else if (m.method === 'thread/start') reply({ thread: { id: 'session-' + ++session } });
  else if (m.method === 'thread/resume')
    m.params.threadId === 'missing'
      ? send({ id: m.id, error: { message: 'not found' } })
      : reply({ thread: { id: m.params.threadId } });
  else if (
    m.method === 'turn/start' &&
    Object.keys(JSON.parse(m.params.input[0].text)).join(',') !==
      'noteText,selectedPassage,conversationHistory,question'
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

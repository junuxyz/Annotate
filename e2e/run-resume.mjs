import * as h from './e2e.mjs';
import { readFileSync } from 'node:fs';
const { ev, type, key, check, sleep, P } = h;
await ev(
  `${P}p.data.codex.enabled=true;p.configureCodex();await p.backend.enable();const t=p.data.threads.find(t=>t.comments.some(c=>c.body==='Local correction $a^2$'));window.__resumeId=t.id;window.__savedSession=t.codex.sessionId;p.openThread(t)`,
);
await type('@chatgpt Reply with READY.');
await key('Enter');
for (let i = 0; i < 120; i++) {
  await sleep(250);
  if (
    await ev(
      `${P}return !['pending','streaming'].includes(p.data.threads.find(t=>t.id===__resumeId).codex.status)`,
    )
  )
    break;
}
check(
  'saved native session resumes after app reload',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__resumeId);return !!__savedSession&&t.codex.sessionId===__savedSession&&t.codex.status==='completed'&&/READY/i.test(t.comments.at(-1).body)`,
  ),
);
check(
  'original ChatGPT mentions survive app reload',
  await ev(`${P}return p.data.threads.some(t=>t.comments.some(c=>c.body.startsWith('@chatgpt'))) `),
);
const original = readFileSync('../test-vault/Fixtures/Codex context.md', 'utf8');
check(
  'commenting leaves the source note unchanged',
  await ev(
    `return (await app.vault.cachedRead(app.vault.getFileByPath('Fixtures/Codex context.md')))===${JSON.stringify(original)}`,
  ),
);
await ev(`${P}p.closePopup();p.data.codex.enabled=false;p.configureCodex();await p.persist()`);
process.exit(h.done());

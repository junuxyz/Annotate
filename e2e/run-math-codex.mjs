import * as h from './e2e.mjs';
const { ev, type, key, click, check, sleep, shot, P } = h;
await ev(
  `${P}const t=p.data.threads.find(t=>t.anchor.quote==='The second test word is amber.');window.__mathCodexId=t.id;p.openThread(t)`,
);
await type(
  '@chatgpt Reply exactly with this LaTeX, including dollar delimiters: $x^2$ then $$\\frac{1}{2}$$',
);
await key('Enter');
for (let i = 0; i < 100; i++) {
  await sleep(250);
  if (
    await ev(`${P}return p.data.threads.find(t=>t.id===__mathCodexId).codex.status==='completed'`)
  )
    break;
}
check(
  'real Codex response renders inline and display LaTeX',
  await ev(
    `const b=document.querySelector('.annotate-message-ai:last-of-type .annotate-message-body');return b.querySelectorAll('mjx-container').length===2&&b.querySelectorAll('.math-block').length===1`,
  ),
);
await shot('math-codex');
await type('@chatgpt Write a 1000-word story about the synthetic word amber.');
await key('Enter');
for (let i = 0; i < 50; i++) {
  await sleep(100);
  if (await ev(`${P}return p.data.threads.find(t=>t.id===__mathCodexId).codex.status==='pending'`))
    break;
}
await ev(`${P}p.backend.child.kill()`);
for (let i = 0; i < 100; i++) {
  await sleep(250);
  if (await ev(`${P}return p.backend.state==='ready'`)) break;
}
const count = await ev(`${P}return p.data.threads.find(t=>t.id===__mathCodexId).comments.length`);
await sleep(1500);
check(
  'backend process failure reconnects without resending unknown request',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__mathCodexId);return p.backend.state==='ready'&&t.codex.status==='unknown'&&t.comments.at(-1).status==='unknown'&&t.comments.length===${count}`,
  ),
);
await shot('math-disconnected');
await click('.annotate-codex-reset');
await ev(
  `${P}const t=p.data.threads.find(t=>t.id===__mathCodexId);t.codex.sessionId='00000000-0000-0000-0000-000000000000'`,
);
await type('@chatgpt What is the synthetic word?');
await key('Enter');
for (let i = 0; i < 100; i++) {
  await sleep(250);
  if (
    await ev(`${P}return p.data.threads.find(t=>t.id===__mathCodexId).codex.status==='unavailable'`)
  )
    break;
}
check(
  'unavailable session requires explicit reset and preserves transcript',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__mathCodexId);return t.codex.status==='unavailable'&&!document.querySelector('.annotate-codex-reset').hidden&&t.comments.length>${count}`,
  ),
);
await click('.annotate-codex-reset');
check(
  'Start new conversation resets unavailable session',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__mathCodexId);return t.codex.status==='idle'&&!t.codex.sessionId`,
  ),
);
await ev(`${P}p.closePopup();await p.persist()`);
process.exit(h.done());

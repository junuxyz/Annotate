import * as h from './e2e.mjs';
const { ev, key, type, check, sleep, P, CMD, SHIFT } = h;
await ev(`${P}p.data.codex.enabled=false;p.configureCodex();await p.persist()`);
for (const m of ['reading', 'live', 'source']) {
  await h.mode(m);
  await ev(
    `${P}p.openThread(p.data.threads.find(t=>t.comments[0]?.body.startsWith('LaTeX test:')))`,
  );
  await sleep(400);
  check(
    `[${m}] saved LaTeX renders after reload`,
    await ev(`return document.querySelectorAll('.math mjx-container').length===8`),
  );
  await ev(`${P}p.closePopup()`);
}
await ev(
  `${P}const t=p.data.threads.find(t=>t.comments[0]?.body.startsWith('Saved edit in light'));p.openThread(t)`,
);
await sleep(400);
check(
  'edited body and removed reply persist after reload',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.comments[0]?.body.startsWith('Saved edit in light'));return t.comments.length===1&&!!document.querySelector('.annotate-message-body mjx-container')&&!p.data.threads.some(t=>t.comments.some(c=>c.body==='Remove this persisted reply'))`,
  ),
);
check(
  'assistant edit and removed question persist after reload',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.anchor.quote==='Select this sentence when asking a question about the test word.');return t.comments.some(c=>c.body==='Local correction $a^2$')&&!t.comments.some(c=>c.body==='@chatgpt Remember the synthetic word azure.')`,
  ),
);
await ev(`${P}p.closePopup()`);
await h.selectEditor('Use the violet flower passage');
await key('m', CMD | SHIFT);
await type('ordinary comment with Codex disabled');
await key('Enter');
await sleep(300);
check(
  'ordinary annotations work with Codex disabled',
  await ev(
    `${P}return !p.data.codex.enabled&&p.backend===null&&document.querySelector('.annotate-message-body').textContent==='ordinary comment with Codex disabled'`,
  ),
);
await ev(`${P}p.closePopup();await p.persist()`);
process.exit(h.done());

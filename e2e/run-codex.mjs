import * as h from './e2e.mjs';
const { ev, key, type, click, shot, check, sleep, P, CMD, SHIFT } = h;
await ev(
  `const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath('Fixtures/Codex context.md'),{state:{mode:'source'}});app.workspace.setActiveLeaf(leaf,{focus:true});await new Promise(r=>setTimeout(r,600))`,
);
const S1 = 'Select this sentence when asking a question about the test word.',
  S2 = 'The second test word is amber.';
const th = (q) =>
  ev(
    `${P}const t=p.data.threads.find(t=>t.anchor.quote===${JSON.stringify(q)});return t&&{st:t.codex?.status,sid:t.codex?.sessionId,c:t.comments.map(c=>[c.role??'user',c.status??'',c.body.slice(0,120)])}`,
  );
const waitDone = async (q) => {
  for (let i = 0; i < 120; i++) {
    const t = await th(q);
    if (t && ['completed', 'failed', 'cancelled', 'unknown', 'unavailable'].includes(t.st))
      return t;
    await sleep(1000);
  }
  return th(q);
};
await h.selectEditor(S1);
await key('m', CMD | SHIFT);
await sleep(300);
await type('@chatgpt What is the test word?');
check(
  'AI send state shown for @chatgpt',
  await ev(
    `return document.querySelector('.annotate-composer').classList.contains('annotate-asking-ai')`,
  ),
);
await key('Enter');
let ui = null;
for (let i = 0; i < 60 && !ui; i++) {
  await sleep(250);
  ui = await ev(
    `const s=document.querySelector('.annotate-codex-status');const ty=document.querySelector('.annotate-typing,.annotate-streaming');return ty||(!s.hidden&&/ChatGPT is/.test(s.textContent))?{status:s.hidden?'':s.textContent,typing:!!document.querySelector('.annotate-typing'),streaming:!!document.querySelector('.annotate-streaming'),stop:!document.querySelector('.annotate-codex-cancel').hidden}:null`,
  );
}
await shot('codex-1-thinking');
check(
  'thinking/streaming indicator and Stop pill shown in-popover',
  ui && (ui.typing || ui.streaming) && ui.stop,
  JSON.stringify(ui),
);
await ev(`document.querySelector('.annotate-composer textarea').focus()`);
await type('draft while streaming');
let t = await waitDone(S1);
check(
  'answer streamed into same popup and uses full note',
  t.st === 'completed' &&
    /violet/i.test(t.c[1][2]) &&
    (await ev(
      `return document.querySelectorAll('.annotate-messages article').length===2 && document.querySelector('.annotate-message-ai .annotate-avatar-ai')!==null`,
    )),
  JSON.stringify(t.c[1]),
);
check(
  'draft kept while streaming',
  await ev(
    `return document.querySelector('.annotate-composer textarea').value==='draft while streaming'`,
  ),
);
check(
  'status line hidden when idle/complete',
  await ev(`return document.querySelector('.annotate-ai-bar').hidden`),
);
await shot('codex-2-answer');
const sid = t.sid;
await ev(
  `const ta=document.querySelector('.annotate-composer textarea');ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()`,
);
await type('@chatgpt What word did I just ask about? Answer in one word.');
await key('Enter');
await sleep(500);
t = await waitDone(S1);
check(
  'follow-up keeps same-thread session/context',
  t.st === 'completed' && t.sid === sid && /violet/i.test(t.c.at(-1)[2]),
  JSON.stringify(t.c.at(-1)),
);
await ev(`${P}p.closePopup()`);
await h.selectEditor(S2);
await key('m', CMD | SHIFT);
await sleep(300);
await type(
  '@chatgpt Which word did I ask about earlier in this conversation? If none, reply NONE.',
);
await key('Enter');
let t2 = await waitDone(S2);
check(
  'separate annotation is a separate conversation',
  t2.st === 'completed' && t2.sid !== sid,
  JSON.stringify(t2.c.at(-1)),
);
// cancel
await ev(`document.querySelector('.annotate-composer textarea').focus()`);
await type('@chatgpt Write a 400-word essay about the colour amber.');
await key('Enter');
for (let i = 0; i < 40; i++) {
  await sleep(250);
  if (await ev(`return !document.querySelector('.annotate-codex-cancel').hidden`)) break;
}
await click('.annotate-codex-cancel');
t2 = await waitDone(S2);
const note = await ev(
  `const n=document.querySelector('.annotate-message-ai:last-of-type p');return n?.textContent`,
);
await shot('codex-3-cancelled');
check(
  'Stop cancels response, partial/notice kept',
  t2.st === 'cancelled',
  JSON.stringify({ st: t2.st, last: t2.c.at(-1), shown: note }),
);
await ev(`${P}p.closePopup();await p.persist()`);
process.exit(h.done());

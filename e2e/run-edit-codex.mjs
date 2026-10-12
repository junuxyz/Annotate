import * as h from './e2e.mjs';
const { ev, key, type, click, check, sleep, shot, P } = h;
const waitDone = async () => {
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    if (
      await ev(
        `${P}return !['pending','streaming'].includes(p.data.threads.find(t=>t.id===__editCodexId).codex?.status)`,
      )
    )
      return;
  }
};
await ev(
  `${P}const t=p.data.threads.find(t=>t.anchor.quote==='Select this sentence when asking a question about the test word.');window.__editCodexId=t.id;window.__oldSession=t.codex.sessionId;p.openThread(t)`,
);
await click('.annotate-message:first-child .annotate-message-edit');
await ev(`document.querySelector('.annotate-message-editor textarea').select()`);
await type('@chatgpt Remember the synthetic word azure.');
await click('.annotate-message-editor button[type=submit]');
check(
  'saving edited model question resets saved session without sending a new turn',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__editCodexId);return !t.codex.sessionId&&t.codex.status==='idle'&&t.comments.length===4&&t.comments[0].body.includes('azure')`,
  ),
);
await ev(`document.querySelector('.annotate-composer textarea').focus()`);
await type(
  '@chatgpt What synthetic word did my first message ask you to remember? Reply with one word.',
);
await key('Enter');
await waitDone();
check(
  'next Codex conversation imports edited text',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__editCodexId);return t.codex.status==='completed'&&t.codex.sessionId!==__oldSession&&/azure/i.test(t.comments.at(-1).body)`,
  ),
);
await click('.annotate-message:last-child .annotate-message-edit');
await ev(`document.querySelector('.annotate-message-editor textarea').select()`);
await type('Local correction $a^2$');
await click('.annotate-message-editor button[type=submit]');
await sleep(300);
check(
  'completed assistant text can be edited and LaTeX re-renders',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__editCodexId);return t.comments.at(-1).body==='Local correction $a^2$'&&!t.codex.sessionId&&!!document.querySelector('.annotate-message:last-child mjx-container')`,
  ),
);
await click('.annotate-message:last-child .annotate-message-edit');
await ev(
  `document.querySelector('.annotate-message-editor textarea').value='unsaved assistant edit';document.querySelector('.annotate-composer textarea').focus()`,
);
await type('@chatgpt Write a 1000-word story about the synthetic word azure.');
await key('Enter');
check(
  'edit/remove and an open edit Save are disabled while response is active',
  await ev(
    `return [...document.querySelectorAll('.annotate-message-edit,.annotate-message-remove')].every(b=>b.disabled)&&document.querySelector('.annotate-message-editor button[type=submit]').disabled`,
  ),
);
await shot('edit-codex-busy');
await click('.annotate-codex-cancel');
await waitDone();
await sleep(300);
check(
  'edit draft survives streaming and controls unlock after cancellation',
  await ev(
    `return document.querySelector('.annotate-message-editor textarea').value==='unsaved assistant edit'&&![...document.querySelectorAll('.annotate-message-edit,.annotate-message-remove')].some(b=>b.disabled)`,
  ),
);
await click('.annotate-message-editor button[type=button]');
const before = await ev(`${P}return p.data.threads.find(t=>t.id===__editCodexId).comments.length`);
await click('.annotate-message:first-child .annotate-message-remove');
await click('.annotate-message:first-child .annotate-message-remove');
await sleep(300);
check(
  'removing model history resets the session and retains remaining transcript',
  await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__editCodexId);return t.comments.length===${before}-1&&!t.codex.sessionId&&t.comments.some(c=>c.body==='Local correction $a^2$')`,
  ),
);
await ev(`${P}p.closePopup();await p.persist()`);
process.exit(h.done());

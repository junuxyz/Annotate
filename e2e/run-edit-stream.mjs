import * as h from './e2e.mjs';
const { ev, type, key, click, check, sleep, P } = h;
await ev(
  `${P}p.data.codex.enabled=true;p.configureCodex();for(let i=0;i<80&&p.backend.state!=='ready';i++)await new Promise(r=>setTimeout(r,250));const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getFileByPath('Fixtures/Codex context.md'));app.workspace.setActiveLeaf(leaf,{focus:true});await new Promise(r=>setTimeout(r,500));const t=p.data.threads.find(t=>t.comments.some(c=>c.body==='Local correction $a^2$'));window.__streamEditId=t.id;p.openThread(t);const item=[...document.querySelectorAll('.annotate-message')].find(el=>el.querySelector('.annotate-message-body').textContent.startsWith('Local correction'));item.querySelector('.annotate-message-edit').click();document.querySelector('.annotate-message-editor textarea').value='draft during actual deltas';document.querySelector('.annotate-composer textarea').focus()`,
);
await type('@chatgpt Count from 1 to 200. Put each number on its own line.');
await key('Enter');
let streamed = false;
for (let i = 0; i < 160; i++) {
  await sleep(250);
  streamed = await ev(
    `${P}const t=p.data.threads.find(t=>t.id===__streamEditId);return t.comments.at(-1).body.length>0`,
  );
  if (streamed) break;
}
check(
  'open edit survives actual streamed text deltas',
  streamed &&
    (await ev(
      `return document.querySelector('.annotate-message-editor textarea').value==='draft during actual deltas'`,
    )),
);
if (await ev(`return !document.querySelector('.annotate-codex-cancel').hidden`))
  await click('.annotate-codex-cancel');
for (let i = 0; i < 80; i++) {
  await sleep(100);
  if (
    await ev(
      `${P}return !['pending','streaming'].includes(p.data.threads.find(t=>t.id===__streamEditId).codex.status)`,
    )
  )
    break;
}
await ev(`${P}p.closePopup();p.data.codex.enabled=false;p.configureCodex();await p.persist()`);
console.log('Hidden instance', await ev(`return require('@electron/remote').process.pid`));
process.exit(h.done());

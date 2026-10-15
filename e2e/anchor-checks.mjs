import * as h from './e2e.mjs';
const { ev, key, type, click, shot, check, sleep, P, CMD, SHIFT } = h;
const Q = 'violet flower';
const expectedCommands = await ev(
  `return Object.keys(app.commands.commands).filter(c=>c.startsWith('annotate:')).length`,
);
await h.mode('live');
await ev(`${P}p.closePopup()`);
// create
await h.selectEditor(Q);
await key('m', CMD | SHIFT);
await sleep(300);
await type('anchor test');
await key('Enter');
await sleep(400);
await ev(`${P}p.closePopup()`);
const E = `const e=app.workspace.activeLeaf.view.editor,t=e.getValue(),i=t.indexOf('Boundary target: ');`;
const quote = async () =>
  ev(
    `${P}const th=p.data.threads.find(t=>t.comments[0]?.body==='anchor test');return th&&{q:th.anchor.quote,o:th.anchor.orphaned,from:th.anchor.from,res:th.resolved,id:th.id,n:th.comments.length}`,
  );
await ev(`${E}e.replaceRange('XX ',e.offsetToPos(i))`);
await sleep(300);
let a = await quote();
check('insert before keeps anchor on text', a.q === Q && !a.o, JSON.stringify(a));
await ev(
  `const e=app.workspace.activeLeaf.view.editor,i=e.getValue().indexOf('violet flower');e.replaceRange('B',e.offsetToPos(i));e.replaceRange('A',e.offsetToPos(i+1+13))`,
);
await sleep(300);
a = await quote();
check('boundary insertions excluded', a.q === Q, JSON.stringify(a));
await ev(
  `const e=app.workspace.activeLeaf.view.editor,i=e.getValue().indexOf('violet flower');e.replaceRange(' bright',e.offsetToPos(i+6))`,
);
await sleep(300);
a = await quote();
check('inside insertion extends quote', a.q === 'violet bright flower', JSON.stringify(a));
await ev(
  `const e=app.workspace.activeLeaf.view.editor,i=e.getValue().indexOf('violet bright flower');e.replaceRange('',e.offsetToPos(i),e.offsetToPos(i+20))`,
);
await sleep(300);
a = await quote();
check('deleting text orphans the thread', a.o, JSON.stringify(a));
await ev(`app.workspace.activeLeaf.view.editor.undo()`);
await sleep(300);
a = await quote();
check('undo does not silently reattach', a.o, JSON.stringify(a));
// reattach via comments list
await h.selectEditor('Repeated passage.\n\nA sep'.slice(0, 17));
await ev(`app.commands.executeCommandById('annotate:show-comment-threads')`);
await sleep(400);
const list = await ev(
  `const m=document.querySelector('.annotate-thread-modal');return m&&{title:m.querySelector('.modal-title')?.textContent,rows:m.querySelectorAll('.annotate-thread-row').length,missing:m.innerText.includes('Text missing'),preview:!!m.querySelector('.annotate-thread-preview .annotate-avatar')}`,
);
check(
  'comments list shows missing anchor and comment preview',
  list && list.rows >= 1 && list.missing && list.preview,
  JSON.stringify(list),
);
await shot('list');
await ev(
  `const b=[...document.querySelectorAll('.annotate-thread-modal button')].find(b=>b.textContent==='Attach to selection');b.click()`,
);
await sleep(300);
a = await quote();
check('attach to selection reattaches', !a.o && a.q === 'Repeated passage.', JSON.stringify(a));
await ev(`${P}p.closePopup()`);
// resolve then reopen from list
await ev(`${P}const th=p.data.threads.find(t=>t.id==='${a.id}');p.openThread(th)`);
await click('.annotate-resolve');
await ev(`${P}p.closePopup()`);
await ev(`app.commands.executeCommandById('annotate:show-comment-threads')`);
await sleep(300);
const resolvedRow = await ev(
  `return !!document.querySelector('.annotate-thread-row.annotate-is-resolved')`,
);
await ev(
  `const r=document.querySelector('.annotate-thread-row.annotate-is-resolved');r.querySelector('button').click()`,
);
await sleep(300);
await click('.annotate-resolve');
await sleep(300);
check(
  'resolved thread re-opened from list, highlight returns',
  resolvedRow &&
    !(await quote()).res &&
    (await ev(
      `return [...document.querySelectorAll('.markdown-source-view .annotate-highlight')].some(e=>e.textContent.startsWith('Repeated'))`,
    )),
);
await ev(`${P}p.closePopup()`);
// persistence: plugin disable/enable
await ev(
  `await app.plugins.disablePlugin('annotate');await new Promise(r=>setTimeout(r,300));await app.plugins.enablePlugin('annotate');await new Promise(r=>setTimeout(r,800))`,
);
a = await quote();
const dup = await ev(
  `return {pop:document.querySelectorAll('.annotate-popover').length,cmds:Object.keys(app.commands.commands).filter(c=>c.startsWith('annotate')).length,hl:document.querySelectorAll('.markdown-source-view .annotate-highlight').length}`,
);
check(
  'disable/enable keeps threads, no duplicate commands or highlights',
  a && a.n === 1 && dup.cmds === expectedCommands && dup.pop === 0,
  JSON.stringify(dup),
);
// rename note & folder
await ev(
  `await app.fileManager.renameFile(app.vault.getFileByPath('Fixtures/Annotations.md'),'Fixtures/Annotations renamed.md')`,
);
await sleep(300);
const p1 = await ev(`${P}return p.data.threads.map(t=>t.path)`);
await ev(`await app.fileManager.renameFile(app.vault.getFolderByPath('Fixtures'),'Fixtures2')`);
await sleep(300);
const p2 = await ev(`${P}return p.data.threads.map(t=>t.path)`);
check(
  'note and folder rename carry threads',
  p1.every((x) => x === 'Fixtures/Annotations renamed.md') &&
    p2.every((x) => x === 'Fixtures2/Annotations renamed.md'),
  JSON.stringify({ p1, p2 }),
);
await ev(
  `await app.fileManager.renameFile(app.vault.getFolderByPath('Fixtures2'),'Fixtures');await app.fileManager.renameFile(app.vault.getFileByPath('Fixtures/Annotations renamed.md'),'Fixtures/Annotations.md')`,
);
await sleep(300);
await ev(`${P}await p.persist()`);
process.exit(h.done());

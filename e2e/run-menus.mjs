import * as h from './e2e.mjs';
const { ev, key, click, check, sleep, P } = h;
for (const m of ['reading', 'live', 'source']) {
  await h.mode(m);
  await sleep(1500);
  m === 'reading'
    ? await h.selectReading('Use the violet flower passage')
    : await h.selectEditor('Use the violet flower passage');
  await ev(`app.commands.executeCommandById('annotate:add-selection-comment')`);
  await sleep(200);
  await ev(
    `const ta=document.querySelector('.annotate-composer textarea');ta.value='Before @ch after';ta.setSelectionRange(10,10);ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()`,
  );
  await click('.annotate-mention-option');
  check(
    `[${m}] mouse mention completion preserves suffix and caret`,
    await ev(
      `const ta=document.querySelector('.annotate-composer textarea');return ta.value==='Before @chatgpt after'&&ta.selectionStart===16&&document.activeElement===ta`,
    ),
  );
  await ev(
    `const ta=document.querySelector('.annotate-composer textarea');ta.value='@';ta.setSelectionRange(1,1);ta.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await h.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await h.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 229,
  });
  await h.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 229,
  });
  check(
    `[${m}] IME Enter does not select mention or submit`,
    await ev(
      `return !!document.querySelector('.annotate-new-comment')&&!document.querySelector('.annotate-composer textarea').value.includes('@chatgpt')`,
    ),
  );
  await h.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await ev(`${P}p.closePopup()`);
}
await h.mode('source');
await h.selectEditor('Use the violet flower passage');
await ev(
  `const e=app.workspace.activeLeaf.view.editor;e.scrollIntoView({from:e.getCursor('from'),to:e.getCursor('to')},true)`,
);
await sleep(500);
await ev(
  `window.__annotateMenu=null;window.__annotateMenuRef=app.workspace.on('editor-menu',menu=>{window.__annotateMenu=menu})`,
);
const pt = await ev(
  `const cm=app.workspace.activeLeaf.view.editor.cm,r=cm.coordsAtPos(cm.state.selection.main.from+5);return [r.left+2,(r.top+r.bottom)/2]`,
);
for (const kind of ['mousePressed', 'mouseReleased'])
  await h.send('Input.dispatchMouseEvent', {
    type: kind,
    x: pt[0],
    y: pt[1],
    button: 'right',
    clickCount: 1,
  });
await sleep(200);
check(
  'editing selection context menu contains comment action',
  await ev(
    `const ok=window.__annotateMenu?.items.some(i=>i.titleEl?.textContent==='Comment on selection');app.workspace.offref(__annotateMenuRef);return ok`,
  ),
);
await key('Escape');
await h.selectEditor('Use the violet flower passage');
await ev(`app.commands.executeCommandById('command-palette:open')`);
await sleep(200);
await ev(
  `const i=document.querySelector('.prompt-input');i.focus();i.value='Annotate';i.dispatchEvent(new Event('input',{bubbles:true}))`,
);
await sleep(200);
check(
  'command palette lists comment on selection',
  await ev(
    `return document.querySelector('.prompt-results').textContent.includes('Comment on selection')`,
  ),
);
await key('Escape');
process.exit(h.done());

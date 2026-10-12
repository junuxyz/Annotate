import * as h from './e2e.mjs';
const { ev, key, type, click, shot, check, sleep, P, CMD, SHIFT } = h;
const Q = 'Boundary target: violet flower.';
const move = async (selector) => {
  const pt = await ev(
    `const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]`,
  );
  await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
  await sleep(200);
};
for (const mode of ['live', 'source', 'reading']) {
  await h.mode(mode);
  await ev(`${P}p.closePopup()`);
  mode === 'reading' ? await h.selectReading(Q) : await h.selectEditor(Q);
  await key('m', CMD | SHIFT);
  await type('Editable $x^2$');
  await key('Enter');
  await sleep(300);
  await type('Reply to keep');
  await key('Enter');
  await sleep(300);
  const id = await ev(`${P}return p.data.threads.at(-1).id`);
  await ev(
    `const ta=document.querySelector('.annotate-composer textarea');ta.value='unsent reply';ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()`,
  );
  await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await sleep(200);
  check(
    `[${mode}] edit/remove controls hidden away from comment`,
    await ev(
      `return [...document.querySelectorAll('.annotate-message-actions')].every(e=>getComputedStyle(e).opacity==='0')&&getComputedStyle(document.querySelector('.annotate-header .annotate-delete')).opacity==='0'`,
    ),
  );
  await shot(`edit-idle-${mode}`);
  await move('.annotate-message:first-child .annotate-message-heading');
  check(
    `[${mode}] hover reveals controls only on that comment`,
    await ev(
      `const a=[...document.querySelectorAll('.annotate-message-actions')];return getComputedStyle(a[0]).opacity==='1'&&getComputedStyle(a[1]).opacity==='0'`,
    ),
  );
  await shot(`edit-hover-${mode}`);
  await click('.annotate-message:first-child .annotate-message-edit');
  check(
    `[${mode}] edit opens raw LaTeX in place and preserves reply draft`,
    await ev(
      `return document.querySelector('.annotate-message-editor textarea').value==='Editable $x^2$'&&document.querySelector('.annotate-composer textarea').value==='unsent reply'&&document.querySelector('.annotate-message-body').hidden`,
    ),
  );
  await ev(`document.querySelector('.annotate-message-editor textarea').select()`);
  await type(String.raw`Edited $\frac{1}{2}$`);
  await key('Enter', SHIFT);
  check(
    `[${mode}] Shift+Enter inserts newline while editing`,
    await ev(
      `return document.querySelector('.annotate-message-editor textarea').value.endsWith('\\n')`,
    ),
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
    `[${mode}] IME Enter does not save edit`,
    await ev(
      `${P}return !!document.querySelector('.annotate-message-editor')&&p.data.threads.find(t=>t.id===${JSON.stringify(id)}).comments[0].body==='Editable $x^2$'`,
    ),
  );
  await h.send('Input.insertText', { text: '한' });
  await shot(`edit-editor-${mode}`);
  await key('Enter');
  await sleep(400);
  check(
    `[${mode}] Enter saves edited text, renders math, and keeps reply draft`,
    await ev(
      `${P}const t=p.data.threads.find(t=>t.id===${JSON.stringify(id)});return t.comments[0].body.includes('Edited')&&t.comments[0].body.includes('한')&&!!document.querySelector('.annotate-message-body mjx-container')&&!document.querySelector('.annotate-message-editor')&&document.querySelector('.annotate-composer textarea').value==='unsent reply'`,
    ),
  );
  await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await sleep(200);
  check(
    `[${mode}] keyboard focus keeps edit controls reachable`,
    await ev(
      `return document.activeElement.classList.contains('annotate-message-edit')&&getComputedStyle(document.querySelector('.annotate-message-actions')).opacity==='1'`,
    ),
  );
  await click('.annotate-message:first-child .annotate-message-edit');
  await ev(`document.querySelector('.annotate-message-editor textarea').select()`);
  await type('discard this');
  await key('Escape');
  check(
    `[${mode}] Escape cancels only edit and keeps thread open`,
    await ev(
      `${P}return !!document.querySelector('.annotate-popover')&&!document.querySelector('.annotate-message-editor')&&p.data.threads.find(t=>t.id===${JSON.stringify(id)}).comments[0].body.startsWith('Edited')`,
    ),
  );
  await click('.annotate-message:first-child .annotate-message-edit');
  await ev(
    `const ta=document.querySelector('.annotate-message-editor textarea');ta.value=' ';ta.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  check(
    `[${mode}] empty edit cannot be saved`,
    await ev(
      `return document.querySelector('.annotate-message-editor button[type=submit]').disabled`,
    ),
  );
  await click('.annotate-message-editor button[type=button]');
  await click('.annotate-message:first-child .annotate-message-remove');
  check(
    `[${mode}] remove requires second click`,
    await ev(
      `${P}return p.data.threads.find(t=>t.id===${JSON.stringify(id)}).comments.length===2&&document.querySelector('.annotate-message-remove').getAttribute('aria-label')==='Confirm remove comment'`,
    ),
  );
  await click('.annotate-message:first-child .annotate-message-remove');
  await sleep(300);
  check(
    `[${mode}] removes only selected comment and updates count`,
    await ev(
      `${P}const t=p.data.threads.find(t=>t.id===${JSON.stringify(id)});return t.comments.length===1&&t.comments[0].body==='Reply to keep'&&document.querySelectorAll('.annotate-messages article').length===1&&document.querySelector('.annotate-composer textarea').value==='unsent reply'&&[...document.querySelectorAll('.annotate-count')].some(e=>e.textContent==='1')`,
    ),
  );
  await ev(`${P}p.closePopup();p.openThread(p.data.threads.find(t=>t.id===${JSON.stringify(id)}))`);
  await sleep(200);
  check(
    `[${mode}] removal remains after reopening`,
    await ev(
      `return document.querySelectorAll('.annotate-messages article').length===1&&document.querySelector('.annotate-message-body').textContent==='Reply to keep'`,
    ),
  );
  await click('.annotate-message-remove');
  await click('.annotate-message-remove');
  await sleep(300);
  check(
    `[${mode}] removing final comment deletes thread and highlight`,
    await ev(
      `${P}return !p.data.threads.some(t=>t.id===${JSON.stringify(id)})&&!document.querySelector('.annotate-popover')&&!document.querySelector('[data-annotate-thread="${id}"]')`,
    ),
  );
}
process.exit(h.done());

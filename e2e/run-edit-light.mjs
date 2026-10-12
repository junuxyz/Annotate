import * as h from './e2e.mjs';
const { ev, key, type, click, shot, check, sleep, P, CMD, SHIFT } = h;
await h.mode('source');
await ev(`app.changeTheme('moonstone')`);
await h.selectEditor('Select this passage and add a comment.');
await key('m', CMD | SHIFT);
await type('Original persisted edit');
await key('Enter');
await sleep(200);
await type('Remove this persisted reply');
await key('Enter');
await sleep(200);
await click('.annotate-message:first-child .annotate-message-edit');
await shot('edit-light');
check(
  'light theme editor opens with original text',
  await ev(
    `return document.body.classList.contains('theme-light')&&document.querySelector('.annotate-message-editor textarea').value==='Original persisted edit'`,
  ),
);
await ev(`document.querySelector('.annotate-message-editor textarea').select()`);
await type('Saved edit in light $x$');
await click('.annotate-message-editor button[type=submit]');
await sleep(300);
check(
  'Save button renders edited LaTeX in light theme',
  await ev(
    `return document.querySelector('.annotate-message:first-child .annotate-message-body').textContent.startsWith('Saved edit in light')&&!!document.querySelector('.annotate-message:first-child mjx-container')`,
  ),
);
await click('.annotate-message:last-child .annotate-message-remove');
await click('.annotate-message:last-child .annotate-message-remove');
await sleep(300);
check(
  'reply removal keeps original edited comment',
  await ev(
    `return document.querySelectorAll('.annotate-messages article').length===1&&document.querySelector('.annotate-message-body').textContent.startsWith('Saved edit in light')`,
  ),
);
await ev(`document.querySelector('.annotate-composer textarea').focus()`);
await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
await sleep(200);
check(
  'light theme idle controls are hidden',
  await ev(
    `return getComputedStyle(document.querySelector('.annotate-message-actions')).opacity==='0'`,
  ),
);
await shot('edit-light-idle');
await ev(`${P}p.closePopup();await p.persist();app.changeTheme('obsidian')`);
process.exit(h.done());

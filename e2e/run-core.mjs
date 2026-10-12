import * as h from './e2e.mjs';
const { ev, key, type, click, shot, check, sleep, threadsFor, P, CMD, SHIFT } = h;
const Q = 'Boundary target: violet flower.';
for (const m of ['live', 'source', 'reading']) {
  const got = await h.mode(m);
  await ev(`${P}p.closePopup()`);
  m === 'reading' ? await h.selectReading(Q) : await h.selectEditor(Q);
  check(
    `[${m}] no floating button on selection`,
    await ev(`return !document.querySelector('.annotate-selection-action')`),
    `mode=${got}`,
  );
  await key('m', CMD | SHIFT);
  await sleep(300);
  const st = await ev(
    `const pop=document.querySelector('.annotate-popover'),ta=document.querySelector('.annotate-composer textarea');const sel=document.querySelector('.annotate-draft-selection');return {nc:!!document.querySelector('.annotate-new-comment'),focus:document.activeElement===ta,draft:!!sel,dy:pop&&sel?Math.round(pop.getBoundingClientRect().top-sel.getBoundingClientRect().bottom):null,ph:ta?.placeholder}`,
  );
  check(
    `[${m}] Cmd+Shift+M opens compact composer with focus`,
    st.nc && st.focus,
    JSON.stringify(st),
  );
  check(
    `[${m}] selection stays highlighted, popover placed below it`,
    st.draft && st.dy >= 0 && st.dy < 60,
    `gap=${st.dy}px`,
  );
  await shot(`${m}-1-composer`);
  await type('first line');
  await key('Enter', SHIFT);
  check(`[${m}] Shift+Enter does not submit`, (await threadsFor(Q)).length === 0);
  await ev(
    `const ta=document.querySelector('.annotate-composer textarea');ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await h.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await sleep(100);
  const ime = await ev(
    `window.__imeEnter=null;document.querySelector('.annotate-composer textarea').addEventListener('keydown',e=>{if(e.key==='Enter')__imeEnter={c:e.isComposing,k:e.keyCode}},{once:true});return 1`,
  );
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
  await h.send('Input.insertText', { text: '한' });
  await sleep(200);
  check(
    `[${m}] Korean IME Enter does not submit`,
    (await threadsFor(Q)).length === 0,
    JSON.stringify(await ev(`return __imeEnter`)),
  );
  await ev(
    `const ta=document.querySelector('.annotate-composer textarea');ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await type('`<b>not html</b>` 한글 코멘트');
  check(
    `[${m}] send button turns active with text`,
    await ev(
      `return document.querySelector('.annotate-composer').classList.contains('annotate-has-text') && !document.querySelector('.annotate-send').disabled`,
    ),
  );
  await key('Enter');
  await sleep(500);
  let t = await threadsFor(Q);
  check(
    `[${m}] Enter creates thread`,
    t.length === 1 && t[0].bodies[0] === '`<b>not html</b>` 한글 코멘트',
  );
  const view = await ev(
    `const a=document.querySelector('.annotate-messages article');return {plain:!document.querySelector('.annotate-messages b'),body:a?.querySelector('p').textContent,av:a?.querySelector('.annotate-avatar')?.textContent,time:a?.querySelector('time')?.textContent,hl:!!document.querySelector('.annotate-highlight'), badge:[...document.querySelectorAll('.annotate-count')].map(b=>b.textContent)}`,
  );
  check(
    `[${m}] thread view shows avatar, name, relative time, literal code`,
    view.plain &&
      view.body === '<b>not html</b> 한글 코멘트' &&
      view.av &&
      view.time === 'Just now',
    JSON.stringify(view),
  );
  await shot(`${m}-2-thread`);
  await type('reply via button');
  await click('.annotate-send');
  await sleep(500);
  t = await threadsFor(Q);
  check(`[${m}] send button posts reply`, t[0]?.n === 2);
  await ev(`document.querySelector('.annotate-composer textarea').focus()`);
  await type('ask @ch');
  const menu = await ev(
    `const m=document.querySelector('.annotate-mention-menu');return {shown:!m.hidden,opts:[...m.querySelectorAll('[role=option]')].map(o=>o.querySelector('strong').textContent)}`,
  );
  check(
    `[${m}] @ shows ChatGPT-only dropdown`,
    menu.shown && menu.opts.join() === 'ChatGPT',
    JSON.stringify(menu),
  );
  await shot(`${m}-3-mention`);
  check(
    `[${m}] popover stays inside the viewport with dropdown open`,
    await ev(
      `return document.querySelector('.annotate-popover').getBoundingClientRect().bottom<=innerHeight`,
    ),
  );
  check(
    `[${m}] dropdown fully visible inside popover`,
    await ev(
      `const m=document.querySelector('.annotate-mention-menu').getBoundingClientRect(),p=document.querySelector('.annotate-popover').getBoundingClientRect();return m.height>20&&m.bottom<=p.bottom+1&&m.top>=p.top`,
    ),
  );
  await key('ArrowDown');
  await key('Enter');
  const after = await ev(
    `const ta=document.querySelector('.annotate-composer textarea');return {v:ta.value,focus:document.activeElement===ta,caret:ta.selectionStart}`,
  );
  check(
    `[${m}] Down+Enter inserts @chatgpt without submitting`,
    after.v === 'ask @chatgpt ' &&
      after.focus &&
      after.caret === after.v.length &&
      (await threadsFor(Q))[0].n === 2,
    JSON.stringify(after),
  );
  await type('x @c');
  await key('Escape');
  check(
    `[${m}] Escape closes only the dropdown`,
    await ev(
      `return document.querySelector('.annotate-mention-menu').hidden && !!document.querySelector('.annotate-popover')`,
    ),
  );
  await ev(
    `const ta=document.querySelector('.annotate-composer textarea');ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await type('mail me at a@chx.com');
  check(
    `[${m}] email/unmatched does not show dropdown`,
    await ev(`return document.querySelector('.annotate-mention-menu').hidden`),
  );
  await ev(
    `const ta=document.querySelector('.annotate-composer textarea');ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await click('.annotate-resolve');
  await sleep(300);
  const res = await ev(
    `return {r:${'(await (async()=>{' + P + 'return p.data.threads.find(t=>t.anchor.quote==="' + Q + '").resolved})())'},banner:!!document.querySelector('.annotate-resolved-banner'),composer:!!document.querySelector('.annotate-composer'),hl:[...document.querySelectorAll('.annotate-highlight')].some(e=>e.textContent.includes('violet flower'))}`,
  );
  check(
    `[${m}] resolve hides highlight and shows Resolved banner`,
    res.r && res.banner && !res.composer && !res.hl,
    JSON.stringify(res),
  );
  await shot(`${m}-4-resolved`);
  await click('.annotate-resolve');
  await sleep(300);
  check(
    `[${m}] re-open restores highlight`,
    await ev(
      `return [...document.querySelectorAll('.annotate-highlight')].some(e=>e.textContent.includes('violet flower'))`,
    ),
  );
  await ev(`${P}p.closePopup()`);
  await sleep(200);
  await click(
    m === 'reading'
      ? '.markdown-reading-view .annotate-count[aria-label*="Boundary target"]'
      : '.markdown-source-view .annotate-count[aria-label*="Boundary target"]',
  );
  const opened = await ev(`return document.querySelector('.annotate-quote')?.textContent`);
  check(`[${m}] badge click opens this thread`, opened === Q, `opened=${JSON.stringify(opened)}`);
  await click('.annotate-delete');
  const armed = await ev(
    `return document.querySelector('.annotate-delete').classList.contains('annotate-armed')`,
  );
  check(`[${m}] delete requires second click`, armed && (await threadsFor(Q)).length === 1);
  await click('.annotate-delete');
  await sleep(300);
  check(
    `[${m}] second click deletes thread`,
    (await threadsFor(Q)).length === 0 &&
      !(await ev(`return !!document.querySelector('.annotate-popover')`)),
  );
}
process.exit(h.done());

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const shots = process.env.SHOTS_DIR || 'shots';
mkdirSync(shots, { recursive: true });
if (!process.env.OWNED_OFFSCREEN_PROFILE)
  throw Error('Run this scenario through the owned offscreen runner.');
const port = process.env.CDP_PORT;
if (!port) throw new Error('Set CDP_PORT to your owned offscreen test instance.');
const list = await (await fetch(`http://localhost:${port}/json`)).json();
const page = list.find(
  (p) =>
    p.type === 'page' &&
    p.url.startsWith('app://obsidian.md/index.html') &&
    p.title.includes('test-vault'),
);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  pending.get(m.id)?.(m);
  pending.delete(m.id);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async()=>{${expr}})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result.exceptionDetails)
    throw new Error(
      r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails),
    );
  return r.result.result.value;
};
const owned = await ev(`return require('@electron/remote').app.__offscreenTest?.profile`);
if (owned !== process.env.OWNED_OFFSCREEN_PROFILE) {
  ws.close();
  throw Error('Refusing an unrelated Obsidian instance');
}
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vk = { Enter: 13, Escape: 27, ArrowDown: 40, Backspace: 8, m: 77, '@': 50 };
const key = async (k, m = 0) => {
  const p = {
    key: k,
    code: k.length === 1 ? (k === '@' ? 'Digit2' : 'Key' + k.toUpperCase()) : k,
    windowsVirtualKeyCode: vk[k] ?? 0,
    modifiers: m,
    ...(k === 'Enter' ? { text: '\r' } : {}),
  };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...p });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
  await sleep(120);
};
const type = async (t) => {
  await send('Input.insertText', { text: t });
  await sleep(120);
};
const click = async (sel) => {
  const pt = await ev(
    `const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('missing '+${JSON.stringify(sel)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
  for (const t of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', {
      type: t,
      x: pt[0],
      y: pt[1],
      button: 'left',
      clickCount: 1,
    });
  await sleep(250);
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};
const results = [];
let failures = 0;
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
  console.log(results.at(-1));
};
const P = `const p=app.plugins.plugins['annotate'];`;
const threadsFor = (q) =>
  ev(
    `${P}return p.data.threads.filter(t=>t.anchor.quote===${JSON.stringify(q)}).map(t=>({n:t.comments.length,r:t.resolved,o:t.anchor.orphaned,bodies:t.comments.map(c=>c.body),from:t.anchor.from,id:t.id}))`,
  );
const CMD = 4,
  SHIFT = 8;
export { ev, key, type, click, shot, check, sleep, threadsFor, P, CMD, SHIFT, send, results };
export const done = () => {
  ws.close();
  return failures;
};
const mode = async (m) =>
  ev(
    `let leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path==='Fixtures/Annotations.md');if(!leaf)leaf=app.workspace.getLeaf('tab');app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.setViewState({type:'markdown',state:{file:'Fixtures/Annotations.md',mode:${JSON.stringify(m === 'reading' ? 'preview' : 'source')},source:${m === 'source'}}});await new Promise(r=>setTimeout(r,700));return leaf.view.getMode()`,
  );
export { mode };
const selectEditor = async (q) => {
  await ev(
    `const v=app.workspace.activeLeaf.view,e=v.editor,t=e.getValue(),i=t.indexOf(${JSON.stringify(q)});e.focus();e.setSelection(e.offsetToPos(i),e.offsetToPos(i+${q.length}));`,
  );
  await sleep(150);
};
const selectReading = async (q) => {
  await ev(
    `const root=app.workspace.activeLeaf.view.previewMode.containerEl;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const i=n.data.indexOf(${JSON.stringify(q)});if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+${q.length});const s=getSelection();s.removeAllRanges();s.addRange(r);return}}throw new Error('text not found')`,
  );
  await sleep(150);
};
export { selectEditor, selectReading };

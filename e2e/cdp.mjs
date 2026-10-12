// usage: node cdp.mjs <cmd> ...   cmds: eval <js>, evalf <file>, shot <png>, click x y, type text, key Name [mods]
import { writeFileSync, readFileSync } from 'node:fs';
const port = process.env.CDP_PORT;
if (!port) throw new Error('Set CDP_PORT to your isolated hidden test instance.');
const list = await (await fetch(`http://localhost:${port}/json`)).json();
const page = list.find(
  (p) => p.type === 'page' && p.url.startsWith('app://') && p.title.includes('test-vault'),
);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const [cmd, ...a] = process.argv.slice(2);
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 1));
};
const mods = (s) =>
  (s || '')
    .split('+')
    .reduce((m, k) => m | ({ alt: 1, ctrl: 2, cmd: 4, meta: 4, shift: 8 }[k] || 0), 0);
if (cmd === 'eval') await evaluate(a[0]);
if (cmd === 'evalf') await evaluate(readFileSync(a[0], 'utf8'));
if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(a[0], Buffer.from(r.result.data, 'base64'));
  console.log('saved', a[0]);
}
if (cmd === 'click')
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', {
      type,
      x: +a[0],
      y: +a[1],
      button: 'left',
      clickCount: 1,
    });
if (cmd === 'type') await send('Input.insertText', { text: a[0] });
if (cmd === 'key') {
  const key = a[0],
    m = mods(a[1]);
  const codes = {
    Enter: 13,
    Escape: 27,
    ArrowDown: 40,
    ArrowUp: 38,
    Backspace: 8,
    m: 77,
    M: 77,
    a: 65,
  };
  const p = {
    key,
    code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
    windowsVirtualKeyCode: codes[key] ?? 0,
    modifiers: m,
    ...(key === 'Enter' && !m ? { text: '\r' } : {}),
  };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...p });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
}
ws.close();

// Start (or reuse) an isolated, hidden Obsidian for E2E. usage: node launch-hidden.mjs <profileDir>
import { spawn } from 'node:child_process';
const profile = process.argv[2],
  port = process.env.CDP_PORT || 9444;
const pages = async () => {
  try {
    return await (await fetch(`http://localhost:${port}/json`)).json();
  } catch {
    return null;
  }
};
const hide = async (page) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const result = await new Promise((r) => {
    ws.onmessage = (e) => r(JSON.parse(e.data));
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          returnByValue: true,
          expression: `(()=>{const r=require('@electron/remote');for(const w of r.BrowserWindow.getAllWindows()){w.webContents.setBackgroundThrottling(false);w.setOpacity(0);w.setIgnoreMouseEvents(true);w.setFocusable(false);w.setSkipTaskbar?.(true);w.setPosition(-30000,-30000);w.hide();if(!w.__annotateHidden){w.__annotateHidden=true;w.on('show',()=>{w.setOpacity(0);w.setPosition(-30000,-30000);w.hide();});}}r.app.dock?.hide();return r.BrowserWindow.getAllWindows().map(w=>w.isVisible()?'visible':'hidden')})()`,
        },
      }),
    );
  });
  ws.close();
  return result.result?.result?.value;
};
const started = Date.now();
let firstHide = null;
let list = await pages();
if (!list)
  spawn(
    'open',
    [
      '-n',
      '-g',
      '-j',
      '-a',
      'Obsidian',
      '--args',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--disable-features=MacWebContentsOcclusion,CalculateNativeWinOcclusion',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
    { stdio: 'ignore' },
  );
for (;;) {
  list = await pages();
  const page = list?.find((p) => p.type === 'page' && p.url.startsWith('app://'));
  // Keep re-applying until the vault window has loaded, since Obsidian re-shows its window after loading.
  if (page) {
    try {
      const v = await hide(page);
      if (v && page.title.includes('test-vault') && Date.now() - started > 4000) {
        console.log(`hidden; first hide within ${firstHide} ms`, v);
        break;
      }
      if (v && firstHide === null) firstHide = Date.now() - started;
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 50));
}

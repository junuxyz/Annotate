// One-command development check in an isolated Obsidian on a Linux virtual display.
// usage: node e2e/dev-check.mjs [--only smoke,ui,list] [--modes live,source,reading] [--themes light,dark]
//                               [--shots] [--record] [--stop] [--profile <dir>] [--port <n>]
// Sets up (or reuses) its own profile, syncs test-vault + current build, resets fixtures and comment data,
// reloads the plugin, runs the selected scenarios with per-step timeouts, and prints a short report.
import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  openSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

if (process.platform !== 'linux') throw new Error('Use npm run check to run E2E through Docker.');
const HERE = dirname(fileURLToPath(import.meta.url)),
  PLUGIN = resolve(HERE, '..'),
  VAULT_SRC = existsSync(resolve(PLUGIN, '../test-vault'))
    ? resolve(PLUGIN, '../test-vault')
    : join(PLUGIN, 'test-vault');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);
const list = (name, def) => arg(name, def).split(',').filter(Boolean);
const only = list('only', 'smoke,ui,list'),
  modes = list('modes', 'live'),
  themes = list('themes', 'light,dark');
// Each checkout gets its own profile and port so parallel sessions never share an instance.
const key = createHash('sha1').update(PLUGIN).digest('hex').slice(0, 8);
const profile = resolve(arg('profile', join(tmpdir(), `annotate-dev-check-${key}`, 'profile')));
const port = Number(
  arg('port', process.env.CDP_PORT || 9500 + (parseInt(key.slice(0, 4), 16) % 400)),
);
const root = dirname(profile),
  vault = join(root, 'test-vault'),
  shotsDir = join(process.env.E2E_OUTPUT || root, 'shots');
const stop = () => {
  try {
    execFileSync('pkill', ['-f', `remote-debugging-port=${port}( |$)`]);
  } catch {}
};
if (flag('stop')) {
  stop();
  console.log('stopped', profile);
  process.exit(0);
}

const t0 = Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) =>
  Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error(`timeout ${ms}ms: ${what}`);
    }),
  ]);
setTimeout(() => {
  console.error('FAIL global timeout (180 s)');
  process.exit(2);
}, 180_000).unref();

// ---------- setup ----------
for (const f of ['main.js', 'manifest.json', 'styles.css'])
  if (!existsSync(join(PLUGIN, f))) throw new Error(`missing ${f}; run npm run build`);
const sha = (f) =>
  createHash('sha256')
    .update(readFileSync(join(PLUGIN, f)))
    .digest('hex');
const hashes = { 'main.js': sha('main.js'), 'styles.css': sha('styles.css') };
const { version, name: pluginName } = JSON.parse(readFileSync(join(PLUGIN, 'manifest.json')));

mkdirSync(profile, { recursive: true });
writeFileSync(
  join(profile, 'obsidian.json'),
  JSON.stringify({ vaults: { annotate0dev0check: { path: vault, ts: 1, open: true } } }),
);

// Fresh notes and settings every run; comment data starts empty with Codex disabled.
const pdir = join(vault, '.obsidian/plugins/annotate');
const keepWorkspace = existsSync(join(vault, '.obsidian/workspace.json'));
for (const e of readdirSync(VAULT_SRC))
  if (e !== '.obsidian') {
    rmSync(join(vault, e), { recursive: true, force: true });
    cpSync(join(VAULT_SRC, e), join(vault, e), { recursive: true });
  }
if (existsSync(join(VAULT_SRC, '.obsidian')))
  cpSync(join(VAULT_SRC, '.obsidian'), join(vault, '.obsidian'), {
    recursive: true,
    filter: (s) => (keepWorkspace ? !s.endsWith('workspace.json') : true),
  });
mkdirSync(pdir, { recursive: true });
writeFileSync(join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['annotate']));
for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(join(PLUGIN, f), join(pdir, f));
const data = {
  version: 1,
  author: 'You',
  threads: [],
  codex: { enabled: false, executable: 'codex' },
};
writeFileSync(
  join(pdir, 'data.json'),
  JSON.stringify({ ...data, threads: [], codex: { ...data.codex, enabled: false } }, null, 2),
);
rmSync(shotsDir, { recursive: true, force: true });
mkdirSync(shotsDir, { recursive: true });

const display = process.env.DISPLAY;
const executable = process.env.OBSIDIAN_BIN;
if (!display || !executable) throw new Error('Run E2E with Docker or OBSIDIAN_BIN under Xvfb.');
const displays = execFileSync('pgrep', ['-a', 'Xvfb'], { encoding: 'utf8' });
if (!displays.split('\n').some((line) => line.split(/\s+/).includes(display)))
  throw new Error('The test display must be owned by Xvfb.');
const startupLog = join(process.env.E2E_OUTPUT || profile, 'obsidian-startup.log');
const output = openSync(startupLog, 'a');
const obsidian = spawn(
  executable,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--password-store=basic',
    ...(process.getuid() === 0 ? ['--no-sandbox'] : []),
  ],
  { stdio: ['ignore', output, output] },
);
let startupError, page;
obsidian.on('error', (error) => {
  startupError = error;
});
const deadline = Date.now() + 45_000;
while (Date.now() < deadline) {
  if (startupError || obsidian.exitCode !== null || obsidian.signalCode !== null)
    throw new Error(
      `Obsidian launch failed: ${startupError || readFileSync(startupLog, 'utf8').slice(-4000)}`,
    );
  try {
    page = (await (await fetch(`http://localhost:${port}/json`)).json()).find(
      (p) => p.type === 'page' && p.url.startsWith('app://') && p.title.includes('test-vault'),
    );
  } catch {}
  if (page) break;
  await sleep(100);
}
if (!page)
  throw new Error(`Obsidian startup timed out: ${readFileSync(startupLog, 'utf8').slice(-4000)}`);

// ---------- CDP ----------
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map(),
  errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(
      m.params.exceptionDetails.exception?.description?.split('\n')[0] ??
        m.params.exceptionDetails.text,
    );
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errors.push(
      m.params.args
        .map((a) => a.value ?? a.description)
        .join(' ')
        .slice(0, 200),
    );
  pending.get(m.id)?.(m);
  pending.delete(m.id);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  withTimeout(
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    10_000,
    method,
  );
const ev = async (expr, what = expr.slice(0, 60)) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async()=>{${expr}})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result.exceptionDetails)
    throw new Error(`${what}: ${r.result.exceptionDetails.exception?.description?.split('\n')[0]}`);
  return r.result.result.value;
};
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
const press = async (k, modifiers = 0) => {
  const p = {
    key: k,
    code: k.length === 1 ? 'Key' + k.toUpperCase() : k,
    windowsVirtualKeyCode: { Enter: 13, Escape: 27, m: 77 }[k] ?? 0,
    modifiers,
    ...(k === 'Enter' ? { text: '\r' } : {}),
  };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...p });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
};
const type = (text) => send('Input.insertText', { text });
const clickAt = async ([x, y]) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
// Poll for a condition instead of fixed sleeps.
const until = async (expr, what, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await ev(expr, what);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await sleep(50);
  }
};
const P = `const p=app.plugins.plugins['annotate'];`;
// Screenshots are best-effort: a hidden window may stop painting, so a capture never blocks or fails a check.
let shotsOk = flag('shots'),
  shotNote = '';
const shot = async (name) => {
  if (!shotsOk) return;
  try {
    const r = await withTimeout(
      send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }),
      3000,
      'screenshot',
    );
    writeFileSync(join(shotsDir, `${name}.jpg`), Buffer.from(r.result.data, 'base64'));
  } catch {
    shotsOk = false;
    shotNote = 'screenshots unavailable (hidden window not painting); visual review pending';
  }
};

// ---------- results ----------
const results = [];
const step = async (name, fn) => {
  const s = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''} (${Date.now() - s} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`FAIL ${name} — ${e.message}`);
    await shot(`failure-${name.replaceAll(/[^a-zA-Z0-9]+/g, '-')}`);
    try {
      await press('Escape');
      await ev(`${P}p.closePopup()`);
    } catch {}
  }
};
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const closeModals = async () => {
  for (
    let i = 0;
    i < 5 && (await ev(`return document.querySelectorAll('.modal-container').length`));
    i++
  ) {
    await press('Escape');
    await sleep(100);
  }
};

// ---------- prepare app ----------
await send('Runtime.enable');
await ev(
  'await new Promise(resolve=>app.workspace.onLayoutReady(resolve))',
  'workspace layout ready',
);
await closeModals();
// Screenshots should show settled UI, not a frame from an entrance animation.
await ev(
  `if(!document.getElementById('annotate-dev-check-still'))document.head.append(Object.assign(document.createElement('style'),{id:'annotate-dev-check-still',textContent:'*,*::before,*::after{animation:none!important;transition:none!important}'}))`,
);
await ev(
  `app.plugins.setEnable(true);await app.plugins.disablePlugin('annotate');await app.plugins.enablePluginAndSave('annotate');`,
  'reload plugin',
);
errors.length = 0;
const QUOTE = 'Boundary target: violet flower.',
  NOTE = 'Fixtures/Annotations.md';
const openMode = (m) =>
  ev(
    `let leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(NOTE)})??app.workspace.getLeaf('tab');
  app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(NOTE)},mode:${JSON.stringify(m === 'reading' ? 'preview' : 'source')},source:${m === 'source'}}});
  await new Promise(r=>setTimeout(r,300));return leaf.view.getMode()`,
    `open ${m}`,
  );
const select = (m, quote = QUOTE) =>
  ev(
    m === 'reading'
      ? `const root=app.workspace.activeLeaf.view.previewMode.containerEl,w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const i=n.data.indexOf(${JSON.stringify(quote)});if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+${quote.length});getSelection().removeAllRanges();getSelection().addRange(r);return true}}throw new Error('quote not in reading view')`
      : `const e=app.workspace.activeLeaf.view.editor,i=e.getValue().indexOf(${JSON.stringify(quote)});if(i<0)throw new Error('quote not in note');e.focus();e.setSelection(e.offsetToPos(i),e.offsetToPos(i+${quote.length}));return true`,
    'select quote',
  );
const threads = () =>
  ev(
    `${P}return p.data.threads.filter(t=>t.anchor.quote===${JSON.stringify(QUOTE)}).map(t=>({id:t.id,n:t.comments.length}))`,
  );
const resetThreads = () =>
  ev(
    `${P}p.closePopup();p.data.threads=[];await p.saveData(p.data);app.workspace.activeLeaf?.view?.previewMode?.rerender?.(true);app.workspace.activeLeaf?.view?.editor?.cm?.dispatch({})`,
  );
const openComposer = async (m, quote = QUOTE) => {
  await openMode(m);
  if (m === 'reading')
    await until(
      `return app.workspace.activeLeaf.view.previewMode.containerEl.textContent.includes(${JSON.stringify(quote)})`,
      'reading note rendered',
      5000,
    );
  // Right after a plugin reload the editor can drop focus once, so reselect until the selection holds.
  for (let i = 0; ; i++) {
    await select(m, quote);
    if (m === 'reading') break;
    try {
      await until(
        `return document.activeElement?.closest('.cm-editor')&&!getSelection().isCollapsed`,
        'editor selection focused',
        1000,
      );
      break;
    } catch (e) {
      if (i === 2)
        throw new Error(
          `${e.message} ${JSON.stringify(await ev(`return {active:document.activeElement?.className,modals:document.querySelectorAll('.modal-container').length,popover:!!document.querySelector('.annotate-popover'),sel:getSelection().toString().slice(0,40)}`))}`,
        );
    }
  }
  await press('m', 8 | 2);
};
const createComment = async (m, text, quote = QUOTE) => {
  await openComposer(m, quote);
  await until(
    `return document.activeElement===document.querySelector('.annotate-new-comment .annotate-composer textarea')`,
    'compact composer focused',
  );
  await type(text);
  await until(
    `return document.querySelector('.annotate-composer')?.classList.contains('annotate-has-text')`,
    'send button active',
  );
  await press('Enter');
  await until(
    `return document.querySelectorAll('.annotate-messages .annotate-message').length===1`,
    'thread view shows comment',
  );
};

const hoverComposer = async () => {
  const point = await ev(
    `const input=document.querySelector('.annotate-composer textarea'),r=input.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point[0], y: point[1] });
  await sleep(1000);
  const result = await ev(
    `const input=document.querySelector('.annotate-composer textarea'),panel=document.querySelector('.annotate-popover');return {placeholder:input.placeholder,label:input.labels[0]?.textContent,dialogLabel:document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent,tooltip:[...document.querySelectorAll('.tooltip')].some(el=>el.getBoundingClientRect().width>0)}`,
  );
  assert(
    result.placeholder === result.label &&
      result.dialogLabel === 'Comment thread' &&
      !result.tooltip,
    JSON.stringify(result),
  );
};

// ---------- scenarios ----------
if (only.includes('ui'))
  for (const theme of themes) {
    await step(`branding [${theme}]: ribbon and settings logo`, async () => {
      await ev(
        `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')});const settings=app.setting,previous=settings.shouldUsePopout;try{settings.shouldUsePopout=()=>false;settings.open();settings.openTabById('annotate')}finally{settings.shouldUsePopout=previous}`,
      );
      try {
        await until(
          `return document.querySelector('.vertical-tab-content .annotate-brand-heading img')`,
          'settings branding rendered',
        );
        assert(
          await ev(
            `const images=[document.querySelector('.annotate-ribbon img'),document.querySelector('.vertical-tab-content .annotate-brand-heading img')];await Promise.all(images.map(image=>image?.decode()));return images.every(image=>image?.naturalWidth>0&&image.src.startsWith('data:image/png;base64,')&&getComputedStyle(image).width!=='0px')`,
          ),
          'embedded logos load in the ribbon and settings',
        );
        await shot(`branding-${theme}`);
      } finally {
        await ev('app.setting.close()');
      }
    });
  }

if (only.includes('smoke')) {
  await step('smoke: plugin loaded, Codex disabled, no load errors', async () => {
    const s = await ev(
      `${P}return {name:p?.manifest.name,v:p?.manifest.version,codex:p?.data.codex?.enabled,css:[...document.styleSheets].some(x=>{try{return [...x.cssRules].some(r=>r.selectorText?.includes('.annotate-popover'))}catch{return false}})}`,
    );
    assert(
      s.name === pluginName && s.v === version && s.codex === false && s.css && !errors.length,
      JSON.stringify({ ...s, errors }),
    );
    return `v${s.v}`;
  });
  await step('smoke: create comment, close, reopen from highlight', async () => {
    await resetThreads();
    await createComment('live', 'smoke comment');
    await ev(`${P}p.closePopup()`);
    const pt = await until(
      `const h=[...document.querySelectorAll('.markdown-source-view .annotate-highlight')].find(e=>e.textContent.includes('violet'));if(!h)return null;const r=h.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
      'highlight rendered',
    );
    await clickAt(pt);
    const body = await until(
      `return document.querySelector('.annotate-popover .annotate-message-body')?.textContent`,
      'thread reopened',
    );
    const t = await threads();
    assert(body === 'smoke comment' && t.length === 1 && t[0].n === 1, JSON.stringify({ body, t }));
  });
  await step('smoke: saved comments survive plugin reload with clean teardown', async () => {
    const before = await ev(`${P}await p.persist();return JSON.stringify(p.data.threads)`);
    await ev(`await app.plugins.disablePlugin('annotate')`);
    assert(
      await ev(
        `return !document.querySelector('.annotate-popover')&&!document.querySelector('.annotate-highlight')`,
      ),
      'plugin UI must be removed on disable',
    );
    await ev(`await app.plugins.enablePlugin('annotate')`);
    const after = await ev(`${P}return JSON.stringify(p.data.threads)`);
    assert(
      isDeepStrictEqual(JSON.parse(before), JSON.parse(after)),
      'saved comments must survive plugin reload',
    );
    assert(
      await ev(
        `return Object.keys(app.commands.commands).filter(id=>id.startsWith('annotate:')).length===2`,
      ),
      'commands must not duplicate on reload',
    );
    await ev(`${P}p.openThread(p.data.threads[0])`);
    await until(
      `return document.querySelector('.annotate-message-body')?.textContent==='smoke comment'`,
      'saved thread rendered',
    );
  });
}
if (only.includes('ui'))
  for (const theme of themes)
    for (const m of modes) {
      await step(`ui [${m}/${theme}]: composer, thread, mention menu, layout`, async () => {
        await ev(`app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`);
        await resetThreads();
        await openComposer(m);
        await until(
          `return document.activeElement===document.querySelector('.annotate-new-comment .annotate-composer textarea')`,
          'compact composer focused',
        );
        await hoverComposer();
        const composerWidth = await ev(
          `return document.querySelector('.annotate-popover').getBoundingClientRect().width`,
        );
        await type(`Looks good in ${m} ${theme}`);
        await until(
          `return document.querySelector('.annotate-composer')?.classList.contains('annotate-has-text')`,
          'send active',
        );
        await shot(`${theme}-${m}-1-composer`);
        await press('Enter');
        await until(
          `return document.querySelectorAll('.annotate-messages .annotate-message').length===1`,
          'thread view',
        );
        const v = await ev(
          `const a=document.querySelector('.annotate-message');return {av:a.querySelector('.annotate-avatar')?.textContent,name:a.querySelector('strong')?.textContent,time:a.querySelector('time')?.textContent}`,
        );
        assert(v.av && v.name && v.time === 'Just now', JSON.stringify(v));
        assert(
          await ev(
            `const r=document.querySelector('.annotate-popover').getBoundingClientRect();return Math.abs(r.width-${composerWidth})<1&&Math.abs(r.width-(innerWidth<=600?innerWidth-24:Math.min(640,innerWidth*.52,innerWidth-24)))<1&&r.height<=Math.min(420,innerHeight*.5,innerHeight-24)+1&&r.left>=0&&r.right<=innerWidth`,
          ),
          'composer and thread keep the same compact, viewport-safe dimensions',
        );
        await hoverComposer();
        await type('ask @ch');
        await until(
          `const m=document.querySelector('.annotate-mention-menu');return m&&!m.hidden`,
          'mention menu',
        );
        const lay = await ev(
          `const p=document.querySelector('.annotate-popover').getBoundingClientRect(),m=document.querySelector('.annotate-mention-menu').getBoundingClientRect();return {inView:p.top>=0&&p.bottom<=innerHeight&&p.left>=0&&p.right<=innerWidth,menuInside:m.height>20&&m.top>=p.top&&m.bottom<=p.bottom+1}`,
        );
        assert(lay.inView && lay.menuInside, JSON.stringify(lay));
        await shot(`${theme}-${m}-2-mention`);
        await press('Escape');
        await ev(`${P}p.closePopup()`);
      });
    }
if (only.includes('highlight'))
  for (const theme of themes) {
    await step(`highlight [${theme}]: one wrapped highlight across inline formatting`, async () => {
      await ev(`app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`);
      await resetThreads();
      const quote = await ev(
        `const text=await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}));return text.split('\\n').find(l=>l.startsWith('This paragraph'))`,
      );
      await createComment('live', 'One highlight across formatted text', quote);
      await ev(`${P}p.closePopup()`);
      for (const mode of modes) {
        await openMode(mode);
        // Move the caret away so Live Preview hides Markdown delimiters.
        if (mode !== 'reading')
          await ev(`app.workspace.activeLeaf.view.editor.setCursor({line:0,ch:0})`);
        // Wrapping must be explicit, independent of platform fonts and window size.
        await ev(
          `const root=app.workspace.activeLeaf.view.${mode === 'reading' ? 'previewMode.containerEl' : 'editor.cm.contentDOM'};for(const node of root.querySelectorAll('.cm-line, p'))node.style.maxWidth='320px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
        );
        await until(
          `const root=app.workspace.activeLeaf.view.${mode === 'reading' ? 'previewMode.containerEl' : 'editor.cm.contentDOM'};return !!root.querySelector('code .annotate-highlight, .cm-inline-code .annotate-highlight, .cm-inline-code.annotate-highlight')`,
          `inline code highlight in ${mode}`,
        );
        const geometry = await ev(`
          const root=app.workspace.activeLeaf.view.${mode === 'reading' ? 'previewMode.containerEl' : 'editor.cm.contentDOM'},
            code=root.querySelector('code:has(.annotate-highlight), .cm-inline-code:has(.annotate-highlight), .cm-inline-code.annotate-highlight'),
            mark=code.matches('.annotate-highlight')?code:code.querySelector('.annotate-highlight'),
            marks=[...root.querySelectorAll('.annotate-highlight')],
            plain=marks.find(n=>n.textContent.startsWith('This paragraph')),
            style=getComputedStyle(code), cs=getComputedStyle(mark), ps=getComputedStyle(plain),
            rects=[...plain.getClientRects()], cr=mark.getBoundingClientRect();
          return {font:cs.fontSize,plainFont:ps.fontSize,background:cs.backgroundColor,plainBackground:ps.backgroundColor,
            padding:style.padding,margin:style.margin,codeBackground:style.backgroundColor,
            codeFont:cs.fontFamily,plainFamily:ps.fontFamily,
            height:cr.height,plainHeight:rects[0].height,
            ids:[...new Set(marks.map(n=>n.dataset.annotateThread))],
            badges:root.querySelectorAll('.annotate-count').length,
            wrapped:new Set(marks.flatMap(n=>[...n.getClientRects()].map(r=>Math.round(r.top)))).size>1};
        `);
        assert(
          geometry.font === geometry.plainFont,
          `${mode}: code shrinks the highlight ${JSON.stringify(geometry)}`,
        );
        assert(
          geometry.background === geometry.plainBackground,
          `${mode}: mismatched highlight colors`,
        );
        assert(
          geometry.padding === '0px' && geometry.margin === '0px',
          `${mode}: code pill leaves gaps`,
        );
        assert(geometry.codeBackground === 'rgba(0, 0, 0, 0)', `${mode}: separate code background`);
        assert(
          Math.abs(geometry.height - geometry.plainHeight) < 1,
          `${mode}: mismatched highlight heights`,
        );
        assert(geometry.codeFont !== geometry.plainFamily, `${mode}: preserve the code typeface`);
        assert(
          geometry.ids.length === 1 && geometry.badges === 1 && geometry.wrapped,
          `${mode}: one wrapped thread ${JSON.stringify(geometry)}`,
        );
        await shot(`${theme}-${mode}-highlight`);
        await ev(
          `const root=app.workspace.activeLeaf.view.${mode === 'reading' ? 'previewMode.containerEl' : 'editor.cm.contentDOM'};for(const node of root.querySelectorAll('.cm-line, p'))node.style.removeProperty('max-width')`,
        );
      }
    });
  }
if (only.includes('list'))
  await step('list: thread list modal shows threads', async () => {
    await resetThreads();
    await createComment('live', 'list comment');
    await ev(`${P}p.closePopup()`);
    await ev(`app.commands.executeCommandById('annotate:show-comment-threads')`);
    const rows = await until(
      `return document.querySelectorAll('.annotate-thread-modal .annotate-thread-row').length`,
      'thread rows',
    );
    await shot('list');
    await closeModals();
    assert(
      !(await ev(`return document.querySelectorAll('.modal-container').length`)),
      'thread list did not close',
    );
    return `${rows} row(s)`;
  });

if (only.includes('markdown'))
  for (const theme of themes)
    for (const m of modes) {
      await step(`markdown [${m}/${theme}]: native syntax, edit, reopen, streaming`, async () => {
        await ev(`app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`);
        await resetThreads();
        const text = [
          '# Comment heading',
          '**bold** *italic* ~~deleted~~ ==highlight== `**literal**`',
          '[web](https://example.com) [[Mentions|note]] #commenttag',
          '%%hidden comment%% visible',
          '> [!note] Callout\n> **callout bold**',
          '- item\n  - nested\n- [x] done\n- [ ] todo',
          '1. first\n2. second',
          '| A | B |\n| --- | --- |\n| one | two |',
          '```js\nconst x = "**code**";\n```',
          '~~~text\n\\(literal\\) **literal**\n~~~',
          '---',
          'Footnote[^1]\n\n[^1]: Footnote text',
          '$x^2$\n\n$$\ny^2\n$$\n\n\\(z^2\\)',
          '![[Annotations#Annotation fixtures]]',
          '<script>window.__annotateUnsafe = true</script>',
        ].join('\n\n');
        await createComment(m, text);
        const selectors = [
          'h1',
          'strong',
          'em',
          'del',
          'mark',
          'code',
          'a.external-link',
          'a.internal-link',
          'a.tag',
          '.callout',
          'ul ul',
          'input.task-list-item-checkbox',
          'ol',
          'table',
          'pre code',
          'hr',
          '.footnotes',
          'mjx-container',
          '.internal-embed',
        ];
        await until(
          `const b=document.querySelector('.annotate-message-body');return b&&${JSON.stringify(selectors)}.every(s=>b.querySelector(s))&&b.querySelectorAll('mjx-container').length===3`,
          'native Markdown syntax',
        );
        const safe = await ev(
          `const b=document.querySelector('.annotate-message-body');return !window.__annotateUnsafe&&!b.querySelector('script')&&!b.textContent.includes('hidden comment')&&b.querySelector('code').textContent==='**literal**'&&[...b.querySelectorAll('pre code')].some(c=>c.textContent.includes('\\\\(literal\\\\) **literal**'))`,
        );
        assert(safe, 'comments, code literals, or native HTML sanitization failed');
        await ev(`document.querySelector('.annotate-messages').scrollTop=0`);
        await shot(`${theme}-${m}-markdown-thread`);
        await ev(`document.querySelector('.annotate-message-body a.internal-link').click()`);
        await until(
          `return app.workspace.activeLeaf.view.file?.path==='Fixtures/Mentions.md'`,
          'relative wiki link navigation',
        );
        await openMode(m);
        await ev(`${P}p.openThread(p.data.threads[0])`);
        await ev(`document.querySelector('.annotate-message-edit').click()`);
        const raw = await ev(
          `return document.querySelector('.annotate-message-editor textarea').value`,
        );
        assert(raw === text, 'editing must preserve Markdown source');
        await ev(
          `const f=document.querySelector('.annotate-message-editor');f.querySelector('textarea').value='**edited**';f.requestSubmit()`,
        );
        await until(
          `return document.querySelector('.annotate-message-body strong')?.textContent==='edited'`,
          'edited Markdown',
        );
        await ev(`${P}const t=p.data.threads[0];p.closePopup();p.openThread(t)`);
        await until(
          `return document.querySelector('.annotate-message-body strong')?.textContent==='edited'`,
          'reopened Markdown',
        );
        await ev(
          `${P}const t=p.data.threads[0];t.comments.push({id:'markdown-stream',author:'ChatGPT',role:'assistant',status:'streaming',body:'**stream bold** $a^2$ unfinished *',createdAt:Date.now()});p.paintCodex()`,
        );
        await until(
          `const b=document.querySelector('[data-message-id="markdown-stream"] .annotate-message-body');return b?.querySelector('strong')?.textContent==='stream bold'&&!!b.querySelector('mjx-container')`,
          'partial streamed Markdown',
        );
        await ev(
          `${P}const c=p.data.threads[0].comments.at(-1);c.body='**obsolete**';p.paintCodex();c.body='**stream bold** $a^2$ finished *italic*';c.status='completed';p.paintCodex()`,
        );
        await until(
          `const b=document.querySelector('[data-message-id="markdown-stream"] .annotate-message-body');return b?.querySelector('em')?.textContent==='italic'&&b.querySelector('strong')?.textContent==='stream bold'&&b.querySelectorAll('mjx-container').length===1`,
          'latest streamed Markdown wins',
        );
        await ev(`${P}p.closePopup()`);
      });
    }

if (only.includes('math'))
  for (const theme of themes)
    for (const m of modes) {
      await step(
        `math [${m}/${theme}]: multiline delimiters, lists, streaming, reopen`,
        async () => {
          await ev(
            `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
          );
          await resetThreads();
          const text = String.raw`- **Scalar/head-wise gate:**

  \[
  \alpha_{t,h} \in \mathbb{R}
  \]

  One decay value scales the whole memory matrix:

  \[
  S_{t,h}=\alpha_{t,h}S_{t-1,h}+\text{update}
  \]

- **Channel-wise gate:**

  \[
  \boldsymbol{\alpha}_{t,h} \in \mathbb{R}^{d_{\text{head}}}
  \]

  Each feature dimension gets its own decay rate:

  \[
  S_{t,h}=\boldsymbol{\alpha}_{t,h}\odot S_{t-1,h}+\text{update}
  \]

  with broadcasting across the relevant axis of $S$.`;
          await createComment(m, text);
          const valid = `const b=document.querySelector('.annotate-message-body');return b?.querySelectorAll('mjx-container').length===5&&b.querySelectorAll('.math-block').length===4&&!b.querySelector('mjx-merror')&&b.querySelectorAll('strong').length===2&&[...b.querySelectorAll('p')].some(p=>p.textContent.includes('One decay value scales the whole memory matrix:')&&!p.querySelector('mjx-container'))&&[...b.querySelectorAll('p')].some(p=>p.textContent.includes('Each feature dimension gets its own decay rate:')&&!p.querySelector('mjx-container'))`;
          await until(valid, 'equations render while prose stays Markdown');
          await ev(`${P}const t=p.data.threads[0];p.closePopup();p.openThread(t)`);
          await until(valid, 'reopened multiline math');
          const mixed =
            String.raw`Inline \(a+b\).

\[
\begin{aligned}
x &= y \\
y &= z
\end{aligned}
\]

Native dollars:
$$
z^2
$$

` + '```latex\n\\[literal\\]\n```';
          await ev(
            `${P}p.data.threads[0].comments.push({id:'math-mixed',author:'You',body:${JSON.stringify(mixed)},createdAt:Date.now()});p.paintCodex()`,
          );
          await until(
            `const b=document.querySelector('[data-message-id="math-mixed"] .annotate-message-body');return b?.querySelectorAll('mjx-container').length===3&&b.querySelectorAll('.math-block').length===2&&!b.querySelector('mjx-merror')&&b.querySelector('pre code')?.textContent.includes('literal')`,
            'aligned equations, native dollars, inline math, literal code',
          );
          await ev(
            `${P}const t=p.data.threads[0];t.comments.push({id:'math-stream',author:'ChatGPT',role:'assistant',status:'streaming',body:${JSON.stringify(text.slice(0, text.lastIndexOf('\\]')))},createdAt:Date.now()});p.paintCodex()`,
          );
          await until(
            `return !!document.querySelector('[data-message-id="math-stream"] mjx-container')`,
            'partial streamed math',
          );
          await ev(
            `${P}const c=p.data.threads[0].comments.at(-1);c.body=${JSON.stringify(text)};c.status='completed';p.paintCodex()`,
          );
          await until(
            `const b=document.querySelector('[data-message-id="math-stream"] .annotate-message-body');return b?.querySelectorAll('mjx-container').length===5&&b.querySelectorAll('strong').length===2&&!b.querySelector('mjx-merror')`,
            'completed streamed multiline math',
          );
          await shot(`${theme}-${m}-math-thread`);
          await ev(`${P}p.closePopup()`);
        },
      );
    }

if (only.includes('quote'))
  for (const theme of themes)
    for (const m of modes) {
      await step(`quote [${m}/${theme}]: selected reply, remove, save and reload`, async () => {
        await ev(`app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`);
        await resetThreads();
        await createComment(m, 'Before **quoted section** after');
        await until(
          `return document.querySelector('.annotate-message-body strong')?.textContent==='quoted section'`,
          'rendered quote source',
        );
        await ev(
          `const b=document.querySelector('.annotate-message-body');b.style.fontSize='24px';b.style.maxWidth='280px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const n=b.querySelector('strong').firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,6);const s=getSelection();s.removeAllRanges();s.addRange(r);b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`,
        );
        const pt = await until(
          `const b=document.querySelector('.annotate-selection-reply');if(!b||b.hidden)return null;const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
          'selected reply action',
        );
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
        const floating = await ev(`
          const b=document.querySelector('.annotate-selection-reply'),r=b.getBoundingClientRect(),
            selected=getSelection().getRangeAt(0).getBoundingClientRect(),s=getComputedStyle(b);
          return {hover:b.matches(':hover'),background:s.backgroundColor,
            outside:r.bottom<=selected.top-4||r.top>=selected.bottom+4,
            inView:r.left>=12&&r.right<=innerWidth-12&&r.top>=12&&r.bottom<=innerHeight-12};
        `);
        assert(
          floating.hover &&
            /^rgb\(/.test(floating.background) &&
            floating.outside &&
            floating.inView,
          `quote action stays opaque and outside the selection: ${JSON.stringify(floating)}`,
        );
        await shot(`${theme}-${m}-quote-action`);
        await clickAt(pt);
        await until(
          `return !document.querySelector('.annotate-reply-preview').hidden&&document.querySelector('.annotate-reply-preview blockquote').textContent==='quoted'&&document.activeElement===document.querySelector('.annotate-composer textarea')`,
          'quote preview and composer focus',
        );
        await type('reply to this section');
        await shot(`${theme}-${m}-quote-composer`);
        await press('Enter');
        await until(
          `return document.querySelectorAll('.annotate-message').length===2`,
          'reply appended',
        );
        assert(
          await ev(
            `${P}return p.data.threads.length===1&&p.data.threads[0].comments[1].quote.text==='quoted'&&p.data.threads[0].comments[1].quote.messageId===p.data.threads[0].comments[0].id&&document.querySelector('.annotate-message:nth-child(2) .annotate-reply-quote').textContent==='quoted'&&document.querySelector('.annotate-reply-preview').hidden`,
          ),
          'reply stays in original thread with selected quote',
        );
        await shot(`${theme}-${m}-quote-thread`);
        await ev(`document.querySelector('.annotate-message-reply').click()`);
        assert(
          await ev(
            `return document.querySelector('.annotate-reply-preview blockquote').textContent==='Before **quoted section** after'`,
          ),
          'whole-message reply is available',
        );
        await ev(
          `document.querySelector('.annotate-reply-preview [aria-label="Remove quote"]').click()`,
        );
        await type('without quote');
        await press('Enter');
        await until(`${P}return p.data.threads[0].comments.length===3`, 'unquoted reply appended');
        assert(
          await ev(`${P}return !p.data.threads[0].comments[2].quote`),
          'removing quote does not attach it',
        );
        await ev(
          `${P}await p.persist();p.closePopup();await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate');app.plugins.plugins['annotate'].openThread(app.plugins.plugins['annotate'].data.threads[0])`,
        );
        assert(
          await ev(
            `${P}return p.data.threads.length===1&&p.data.threads[0].comments[1].quote.text==='quoted'&&document.querySelector('.annotate-message:nth-child(2) .annotate-reply-quote').textContent==='quoted'`,
          ),
          'quote survives plugin reload',
        );
        await ev(`${P}p.closePopup()`);
      });
    }

if (only.includes('copy'))
  for (const theme of themes)
    for (const mode of modes) {
      await step(`copy [${mode}/${theme}]: message and entire thread`, async () => {
        await ev(`app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`);
        await resetThreads();
        const markdown = '**Copy this**\n\n```js\nconst value = 42;\n```';
        await createComment(mode, markdown);
        // Capture Clipboard API writes without replacing the user's system clipboard.
        await ev(
          `window.__annotateCopyWrites=[];window.__annotateCopyOriginal=navigator.clipboard.writeText;navigator.clipboard.writeText=async text=>window.__annotateCopyWrites.push(text)`,
        );
        try {
          const buttonPoint = async (selector) => {
            await ev(`await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
            const pt = await ev(
              `const b=document.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
            );
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
            await until(
              `const b=document.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return b===hit||b.contains(hit)`,
              'copy button receives pointer input',
            );
            return await ev(
              `const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
            );
          };
          await clickAt(await buttonPoint('.annotate-message-copy'));
          await until(`return window.__annotateCopyWrites.length===1`, 'message copied');
          assert(
            await ev(
              `return window.__annotateCopyWrites[0]===${JSON.stringify(markdown)}&&document.querySelector('.annotate-message-copy').getAttribute('aria-label')==='Copied'`,
            ),
            'copy message preserves Markdown and confirms success',
          );
          await ev(`document.querySelector('.annotate-composer textarea').focus()`);
          await type('Second message');
          await press('Enter');
          await until(
            `return document.querySelectorAll('.annotate-message-copy').length===2`,
            'each message has a copy button',
          );
          await clickAt(await buttonPoint('.annotate-copy-thread'));
          await until(`return window.__annotateCopyWrites.length===2`, 'thread copied');
          const expected =
            '> ' + QUOTE + '\n\n---\n\nYou:\n\n' + markdown + '\n\n---\n\nYou:\n\nSecond message';
          assert(
            await ev(
              `return window.__annotateCopyWrites[1]===${JSON.stringify(expected)}&&document.querySelector('.annotate-copy-thread').getAttribute('aria-label')==='Copied'`,
            ),
            'entire thread includes passage, authors and all messages in order',
          );
          await shot(`${theme}-${mode}-copy-thread`);
        } finally {
          await ev(
            `navigator.clipboard.writeText=window.__annotateCopyOriginal;delete window.__annotateCopyOriginal;delete window.__annotateCopyWrites;${P}p.closePopup()`,
          );
        }
      });
    }

// ---------- cleanup + report ----------
await ev(`${P}p.closePopup();app.changeTheme('moonstone')`).catch(() => {});
await resetThreads().catch(() => {});
results.push({ name: 'display: isolated Linux virtual display', ok: true });
if (errors.length)
  results.push({
    name: 'no console errors during run',
    ok: false,
    err: errors.slice(0, 5).join(' | '),
  });
const failed = results.filter((r) => !r.ok),
  secs = ((Date.now() - t0) / 1000).toFixed(1);
const appVersion = await ev("return require('@electron/remote').app.getVersion()");
const env = `Obsidian ${appVersion}, Linux / Xvfb`;
console.log(
  `\n${failed.length ? 'FAILED' : 'OK'} ${results.length - failed.length}/${results.length} in ${secs}s · ${env} · port ${port}`,
);
if (flag('shots')) console.log(shotNote || `shots: ${shotsDir}`);
if (flag('record')) {
  const md = [
    `\n## ${new Date().toISOString().slice(0, 10)} — dev-check (${only.join(', ')}; modes ${modes.join('/')}; themes ${themes.join('/')})`,
    '',
    `- Build: v${version}, main.js \`${hashes['main.js']}\`, styles.css \`${hashes['styles.css']}\``,
    `- Env: ${env}, isolated hidden profile \`${profile}\``,
    ...results.map((r) => `- ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.err ? ` — ${r.err}` : ''}`),
    ...(shotNote ? [`- ${shotNote}`] : []),
    `- Duration: ${secs}s. Development validation only; release validation pending.`,
  ].join('\n');
  const report = join(process.env.E2E_OUTPUT || VAULT_SRC, 'Validation results.md');
  appendFileSync(report, md + '\n');
  console.log(`recorded to ${report}`);
}
ws.close();
process.exit(failed.length ? 1 : 0);

// One-command development check in an isolated Obsidian on a Linux virtual display.
// usage: node e2e/dev-check.mjs [--only smoke,ui,list,polish] [--modes live,source,reading] [--themes light,dark]
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
const only = list('only', 'smoke,ui,list,polish'),
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
  agent: { folders: [], webSearch: false, services: [], consentVersion: 1 },
  codex: { enabled: false, executable: 'codex' },
  assistant: {
    provider: 'chatgpt',
    claude: { executable: 'claude', model: 'claude-sonnet-5-5' },
  },
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
    windowsVirtualKeyCode: { Enter: 13, Escape: 27, m: 77, h: 72, z: 90, y: 89 }[k] ?? 0,
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
  `const previous=app.plugins.plugins['annotate'];if(previous){previous.data=${JSON.stringify(data)};previous.configureCodex();await previous.persist();}await app.plugins.setEnable(true);await app.plugins.disablePlugin('annotate');await app.plugins.enablePluginAndSave('annotate');`,
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
      ? `document.activeElement?.blur();const root=app.workspace.activeLeaf.view.previewMode.containerEl,w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const i=n.data.indexOf(${JSON.stringify(quote)});if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+${quote.length});getSelection().removeAllRanges();getSelection().addRange(r);return true}}throw new Error('quote not in reading view')`
      : `const e=app.workspace.activeLeaf.view.editor,i=e.getValue().indexOf(${JSON.stringify(quote)});if(i<0)throw new Error('quote not in note');e.focus();e.setSelection(e.offsetToPos(i),e.offsetToPos(i+${quote.length}));return true`,
    'select quote',
  );
const threads = () =>
  ev(
    `${P}return p.data.threads.filter(t=>t.anchor.quote===${JSON.stringify(QUOTE)}).map(t=>({id:t.id,n:t.comments.length}))`,
  );
const resetThreads = () =>
  ev(
    `${P}p.closePopup();p.data.threads=[];await p.persist();app.workspace.activeLeaf?.view?.previewMode?.rerender?.(true);app.workspace.activeLeaf?.view?.editor?.cm?.dispatch({})`,
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
          { cause: e },
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
  try {
    await until(
      `return document.querySelectorAll('.annotate-messages .annotate-message').length===1`,
      'thread view shows comment',
    );
  } catch (error) {
    console.error(
      'Comment creation diagnostic',
      await ev(
        `${P}return {threads:p.data.threads.length,conflict:p.conflictBackup,notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent),composer:document.querySelector('.annotate-composer textarea')?.value}`,
      ),
    );
    throw error;
  }
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

if (only.includes('settings-layout'))
  for (const theme of themes)
    await step(`settings-layout [${theme}]: palette fits default and narrow settings`, async () => {
      await ev(
        `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')});const settings=app.setting,previous=settings.shouldUsePopout;try{settings.shouldUsePopout=()=>false;settings.open();settings.openTabById('annotate')}finally{settings.shouldUsePopout=previous}`,
      );
      try {
        for (const width of [null, 320]) {
          await ev(
            `const a=document.querySelector('.annotate-settings-advanced');a.open=true;a.style.maxWidth=${JSON.stringify(width ? width + 'px' : 'none')};a.querySelector('.annotate-settings-highlight-color').scrollIntoView({block:'center'});`,
          );
          const layout = await ev(
            `const a=document.querySelector('.annotate-settings-advanced');return {fits:a.scrollWidth<=a.clientWidth+1,rows:[...a.querySelectorAll('.annotate-settings-highlight-color')].map(row=>{const r=row.getBoundingClientRect();return {width:r.width,fits:[...row.querySelectorAll('input,button')].every(control=>{const c=control.getBoundingClientRect();return c.width>0&&c.left>=r.left-1&&c.right<=r.right+1})}})}`,
          );
          assert(
            layout.fits && layout.rows.length === 3 && layout.rows.every((row) => row.fits),
            JSON.stringify(layout),
          );
          await shot(`settings-palette-${theme}-${width ?? 'default'}`);
        }
      } finally {
        await ev('app.setting.close()');
      }
    });

if (only.includes('palette'))
  for (const theme of themes)
    for (const mode of modes)
      await step(
        `palette [${mode}/${theme}]: selection menu, colors, shortcuts, undo, reload, settings`,
        async () => {
          await closeModals();
          await resetThreads();
          const original = await ev(
            `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))`,
          );
          const noteText = () =>
            ev(
              `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))`,
            );
          const toolClick = async (label) => {
            const point = await ev(
              `const b=[...document.querySelectorAll('.annotate-selection-tools button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('No selection action '+${JSON.stringify(label)});const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
            );
            await clickAt(point);
          };
          try {
            await ev(
              `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
            );
            await createComment(mode, 'Comment remains attached through highlighting');
            await press('Escape');
            await until(
              `${P}return !p.refreshPending&&!document.querySelector('.annotate-is-closing')`,
              'composer teardown settled',
            );
            await openMode(mode);
            await select(mode);
            await until(
              `return document.querySelector('.annotate-selection-tools')?.textContent==='HighlightColorAnnotate'`,
              'minimal selection actions visible',
            );
            const aboveSelection = async () =>
              ev(
                `const bar=document.querySelector('.annotate-selection-tools').getBoundingClientRect(),r=getSelection().getRangeAt(0).getBoundingClientRect();return {above:bar.bottom<=r.top-4,inViewport:bar.left>=0&&bar.right<=innerWidth&&bar.top>=0,bar:{top:bar.top,bottom:bar.bottom},selectionTop:r.top}`,
              );
            const actionsPosition = await aboveSelection();
            assert(
              actionsPosition.above && actionsPosition.inViewport,
              'actions above selection: ' + JSON.stringify(actionsPosition),
            );
            await shot(`palette-actions-${mode}-${theme}`);
            await toolClick('Highlight');
            // Wait beyond the deferred mouseup/selection callback that previously closed the colors.
            await sleep(350);
            assert(
              await ev(
                `return !!document.querySelector('.annotate-color-swatch[aria-label="Highlight Pink"]')&&!document.querySelector('.annotate-selection-divider')`,
              ),
              'color palette remains open after click',
            );
            await ev(`document.dispatchEvent(new Event('selectionchange'))`);
            await sleep(250);
            assert(
              await ev(
                `return !!document.querySelector('.annotate-color-swatch[aria-label="Highlight Pink"]')`,
              ),
              'same selection keeps palette open',
            );
            const palettePosition = await aboveSelection();
            assert(
              palettePosition.above && palettePosition.inViewport,
              'colors above selection: ' + JSON.stringify(palettePosition),
            );
            await shot(`palette-colors-${mode}-${theme}`);
            await toolClick('Pink');
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes('data-annotate-highlight="pink"'))`,
              'pink saved in Markdown',
            );
            assert((await noteText()).includes(QUOTE), 'highlight preserves selected text');
            // Selecting highlighted text and using the shortcut applies the same most recent color.
            await select(mode);
            await press('h', 8 | 2);
            await until(`${P}return p.data.highlights.recent==='pink'`, 'shortcut uses last color');
            const marked = await noteText();
            assert(
              (marked.match(/data-annotate-highlight="pink"/g) ?? []).length === 1,
              'repeated shortcut does not nest highlights',
            );
            await select(mode);
            await until(
              `return !!document.querySelector('.annotate-selection-tools')`,
              'palette reopens',
            );
            await toolClick('Highlight');
            await toolClick('Light blue');
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes('data-annotate-highlight="light-blue"'))`,
              'recolor replaces existing mark',
            );
            if (mode !== 'source')
              await until(
                `return [...document.querySelectorAll('[data-annotate-highlight="light-blue"]')].some(m=>m.getBoundingClientRect().width>0)`,
                'colored mark rendered',
              );
            assert(
              await ev(
                `${P}return p.data.threads.length===1&&!p.data.threads[0].anchor.orphaned&&p.data.threads[0].anchor.quote===${JSON.stringify(QUOTE)}`,
              ),
              'comment stays attached through recoloring: ' +
                JSON.stringify(await ev(`${P}return p.data.threads.map(t=>t.anchor)`)),
            );
            if (mode !== 'reading') {
              await press('z', 2);
              await until(
                `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes('data-annotate-highlight="pink"'))`,
                'undo restores previous color',
              );
              await press('y', 2);
              await until(
                `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes('data-annotate-highlight="light-blue"'))`,
                'redo restores chosen color',
              );
            }
            await ev(
              `${P}await p.persist();await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
            );
            assert(
              await ev(
                `${P}return p.data.highlights.recent==='light-blue'&&p.data.threads.length===1&&!p.data.threads[0].anchor.orphaned`,
              ),
              'palette and comment anchor survive reload',
            );
            if (mode === 'live')
              assert(
                await ev(
                  `return !app.workspace.activeLeaf.view.containerEl.innerText.includes('<mark')`,
                ),
                'Live Preview conceals highlight tags while editing',
              );
            await shot(`palette-highlight-${mode}-${theme}`);
            await select(mode);
            await press('m', 8 | 2);
            await until(
              `return !!document.querySelector('.annotate-new-comment textarea')`,
              'Ctrl Shift M opens Annotate',
            );
            await press('Escape');
            await until(
              `${P}return !p.refreshPending&&!document.querySelector('.annotate-is-closing')`,
              'composer teardown settled',
            );
            // Verify the Annotate action in the same floating menu.
            await select(mode);
            await until(
              `return !!document.querySelector('.annotate-selection-tools')`,
              'actions return after composer',
            );
            await toolClick('Annotate');
            await until(
              `return !!document.querySelector('.annotate-new-comment textarea')`,
              'Annotate click opens composer',
            );
            await press('Escape');
            await until(
              `${P}return !p.refreshPending&&!document.querySelector('.annotate-is-closing')`,
              'composer teardown settled',
            );
            await select(mode);
            await until(
              `return !!document.querySelector('.annotate-selection-tools')`,
              'actions return for removal',
            );
            await toolClick('Highlight');
            await toolClick('Remove');
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s===${JSON.stringify(original)})`,
              'removal restores note exactly',
            );
            // Text color uses the same floating menu, keeps comments attached, and removes cleanly.
            await select(mode);
            await until(
              `return !!document.querySelector('.annotate-selection-tools')`,
              'actions return for text color',
            );
            await toolClick('Color');
            await sleep(350);
            assert(
              await ev(
                `return !!document.querySelector('.annotate-text-swatch[aria-label="Text color Blue"]')`,
              ),
              'text color palette remains open after click',
            );
            await shot(`palette-text-${mode}-${theme}`);
            await toolClick('Blue');
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes('data-annotate-color="blue"'))`,
              'text color saved in Markdown',
            );
            assert((await noteText()).includes(QUOTE), 'text color preserves selected text');
            assert(
              await ev(
                `${P}return p.data.highlights.textRecent==='blue'&&p.data.threads.length===1&&!p.data.threads[0].anchor.orphaned&&p.data.threads[0].anchor.quote===${JSON.stringify(QUOTE)}`,
              ),
              'comment stays attached through text color',
            );
            if (mode !== 'source')
              await until(
                `const e=[...document.querySelectorAll('[data-annotate-color="blue"]')].find(e=>e.getBoundingClientRect().width>0);return !!e&&getComputedStyle(e).color!==getComputedStyle(document.body).color`,
                'colored text rendered',
              );
            if (mode === 'live')
              assert(
                await ev(
                  `return !app.workspace.activeLeaf.view.containerEl.innerText.includes('<span')`,
                ),
                'Live Preview conceals text color tags while editing',
              );
            await shot(`palette-text-applied-${mode}-${theme}`);
            await select(mode);
            await until(
              `return !!document.querySelector('.annotate-selection-tools')`,
              'actions return for text color removal',
            );
            await toolClick('Color');
            await toolClick('Remove');
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s===${JSON.stringify(original)})`,
              'text color removal restores note exactly',
            );
            await select(mode);
            await press('h', 8 | 2);
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes('data-annotate-highlight="light-blue"'))`,
              'Ctrl Shift H applies most recent color without opening palette',
            );
            await ev(
              `${P}await p.persist();await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
            );
            assert(
              await ev(
                `${P}return p.data.highlights.recent==='light-blue'&&!document.querySelector('.annotate-selection-tools')`,
              ),
              'last color persists and toolbar tears down',
            );
            await ev(
              `const settings=app.setting,previous=settings.shouldUsePopout;try{settings.shouldUsePopout=()=>false;settings.open();settings.openTabById('annotate')}finally{settings.shouldUsePopout=previous}`,
            );
            assert(
              await ev(
                `const a=document.querySelector('.annotate-settings-advanced');a.open=true;return a.textContent.includes('Highlight shape')&&a.textContent.includes('Highlight palette')&&a.querySelector('input[aria-label="Pink highlight color"]')`,
              ),
              'Advanced exposes color and shape customization',
            );
            await ev(
              `const a=document.querySelector('.annotate-settings-advanced'),row=[...a.querySelectorAll('.setting-item')].find(r=>r.textContent.includes('Highlight shape')),s=row.querySelector('select');s.value='underline';s.dispatchEvent(new Event('change'));`,
            );
            assert(
              await ev(`${P}return p.data.highlights.shape==='underline'`),
              'shape customization applies',
            );
            await ev(
              `const input=document.querySelector('input[aria-label="Pink highlight color"]');input.value='#00aabb88';input.dispatchEvent(new Event('input',{bubbles:true}))`,
            );
            assert(
              await ev(
                `${P}return p.data.highlights.colors.find(c=>c.id==='pink').value==='#00aabb88'`,
              ),
              'custom color applies',
            );
            await ev(
              `${P}await p.persist();await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
            );
            assert(
              await ev(
                `${P}return p.data.highlights.shape==='underline'&&p.data.highlights.colors.find(c=>c.id==='pink').value==='#00aabb88'`,
              ),
              'custom color and shape persist',
            );

            await ev(
              `app.setting.close();${P}p.data.highlights.shape='rounded';p.data.highlights.textRecent='red';p.data.highlights.colors.find(c=>c.id==='pink').value='#ff8fc780';p.refreshHighlightStyles();p.changed()`,
            );
          } catch (error) {
            const state = await ev(
              `${P}return {hotkeys:app.hotkeyManager.getDefaultHotkeys('editor:redo'),active:document.activeElement?.className,popup:!!p.popup,selected:getSelection().toString(),target:!!p.selectedNote(),anchor:p.data.threads.map(t=>t.anchor)}`,
            );
            throw new Error(error.message + ' ' + JSON.stringify(state), { cause: error });
          } finally {
            await closeModals();
            await ev(
              `${P}p.hideSelectionTools();p.closePopup();await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(original)});`,
            );
          }
        },
      );

if (only.includes('formatting'))
  for (const mode of modes)
    for (const { sample, bold, fixture } of [
      {
        fixture: 'nested-color',
        bold: '터널 시각',
        sample:
          '**<span data-annotate-color="blue" style="color: blue;">굵은 제목</span>** : 주변 시각을 잃는 질환. 가운데만 보이는 **터널 시각**이 나타날 수 있음.',
      },
      {
        fixture: 'existing-highlight',
        bold: '주변과 비교하여 밝기 차이와 경계를 강조한다',
        sample:
          '<mark data-annotate-highlight="yellow" style="background: #ffe98f80; box-shadow: none; border-radius: 0.2em;">시각계는 지점의 밝기를 독립적으로 처리하지 않고, **주변과 비교하여 밝기 차이와 경계를 강조한다**는 것</mark>.',
      },
    ])
      await step(
        `formatting [${mode}/${fixture}]: highlighting preserves Korean bold text`,
        async () => {
          await closeModals();
          await resetThreads();
          const original = await ev(
            `return app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))`,
          );
          try {
            await ev(
              `await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(sample)})`,
            );
            await openMode(mode);
            if (mode === 'reading') {
              await ev(
                `document.activeElement?.blur();const root=app.workspace.activeLeaf.view.previewMode.containerEl;const p=[...root.querySelectorAll('p')].find(p=>p.textContent.includes(${JSON.stringify(bold)}));const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r)`,
              );
            } else {
              await ev(
                `const e=app.workspace.activeLeaf.view.editor;e.focus();e.setSelection(e.offsetToPos(0),e.offsetToPos(e.getValue().length))`,
              );
            }
            await until(`${P}return !!p.selectedNote()`, 'formatted passage selected');
            await ev(`app.commands.executeCommandById('annotate:highlight-selection')`);
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes('data-annotate-highlight'))`,
              'formatted highlight saved',
            );
            await openMode('live');
            await ev(
              `const e=app.workspace.activeLeaf.view.editor;e.setValue(e.getValue()+'\\n\\noutside');e.setCursor(e.lastLine(),0);e.focus()`,
            );
            await sleep(200);
            const live = await ev(
              `const root=app.workspace.activeLeaf.view.containerEl.querySelector('.cm-content');return {text:[...root.querySelectorAll('.cm-line')].map(e=>e.textContent).join(' '),bold:[...root.querySelectorAll('mark')].filter(e=>e.textContent===${JSON.stringify(bold)}).map(e=>getComputedStyle(e).fontWeight),html:root.innerHTML}`,
            );
            assert(
              live.bold.some((weight) => Number(weight) >= 600) && !live.text.includes('**'),
              JSON.stringify(live),
            );
            await shot(`formatting-live-${mode}-${fixture}`);
            await openMode('reading');
            await until(
              `const root=app.workspace.activeLeaf.view.previewMode.containerEl;return root.querySelector('mark')`,
              'highlight rendered',
            );
            const rendered = await ev(
              `const root=app.workspace.activeLeaf.view.previewMode.containerEl;return {text:root.textContent,strong:[...root.querySelectorAll('strong')].map(e=>e.textContent),html:root.querySelector('p')?.innerHTML}`,
            );
            assert(
              rendered.strong.includes(bold) && !rendered.text.includes('**'),
              JSON.stringify(rendered),
            );
            await shot(`formatting-${mode}-${fixture}`);
          } finally {
            await ev(
              `${P}p.hideSelectionTools();p.closePopup();await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(original)})`,
            );
          }
        },
      );

if (only.includes('combo'))
  for (const theme of themes)
    for (const mode of modes)
      for (const order of ['color-first', 'highlight-first'])
        await step(
          `combo [${mode}/${theme}/${order}]: text color and highlight together`,
          async () => {
            await closeModals();
            await resetThreads();
            const original = await ev(
              `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))`,
            );
            const click = async (label) => {
              const point = await ev(
                `const b=[...document.querySelectorAll('.annotate-selection-tools button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('No selection action '+${JSON.stringify(label)});const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
              );
              await clickAt(point);
            };
            const saved = (text) =>
              until(
                `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})).then(s=>s.includes(${JSON.stringify(text)}))`,
                `${text} saved`,
              );
            const apply = async (action, swatch, text, first) => {
              // Edit modes keep the menu open on the same text after the first style.
              if (first || mode === 'reading') await select(mode);
              await until(
                `return document.querySelector('.annotate-selection-tools')?.textContent==='HighlightColorAnnotate'`,
                'actions',
              );
              await click(action);
              await click(swatch);
              await saved(text);
            };
            try {
              await ev(
                `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
              );
              await openMode(mode);
              const steps = [
                ['Color', 'Blue', 'data-annotate-color="blue"'],
                ['Highlight', 'Pink', 'data-annotate-highlight="pink"'],
              ];
              if (order === 'highlight-first') steps.reverse();
              for (const [index, [action, swatch, text]] of steps.entries())
                await apply(action, swatch, text, index === 0);
              const source = await ev(
                `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))`,
              );
              assert(
                source.includes('data-annotate-color="blue"') &&
                  source.includes('data-annotate-highlight="pink"') &&
                  source.replace(/<[^>]+>/g, '').includes(QUOTE),
                'both styles saved around the same text: ' +
                  source.split('\n').find((l) => l.includes('violet')),
              );
              const style = () =>
                ev(
                  `const root=app.workspace.activeLeaf.view.containerEl.querySelector(${JSON.stringify(mode === 'reading' ? '.markdown-preview-view' : '.cm-content')}),w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(n.data.includes('violet')&&n.parentElement.getBoundingClientRect().width>0)break}if(!n)return null;const probe=document.createElement('span');probe.style.color='var(--color-blue, #337ea9)';document.body.append(probe);const blue=getComputedStyle(probe).color;probe.remove();let e=n.parentElement,bg=null;while(e&&e!==root){const b=getComputedStyle(e).backgroundColor;if(e.matches('[data-annotate-highlight="pink"]')&&b!=='rgba(0, 0, 0, 0)')bg=b;e=e.parentElement}return {color:getComputedStyle(n.parentElement).color,blue,bg}`,
                );
              await until(`${P}return !p.refreshPending`, 'render settled');
              let rendered;
              const end = Date.now() + 3000;
              do {
                rendered = await style();
                if (rendered?.bg && rendered.color === rendered.blue) break;
                await sleep(100);
              } while (Date.now() < end);
              await shot(`combo-${mode}-${theme}-${order}`);
              assert(
                rendered?.bg && rendered.color === rendered.blue,
                'text shows blue color on pink highlight: ' + JSON.stringify(rendered),
              );
            } finally {
              await closeModals();
              await ev(
                `${P}p.hideSelectionTools();p.closePopup();await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(original)});`,
              );
            }
          },
        );

if (only.includes('ui'))
  for (const theme of themes) {
    await step(`branding [${theme}]: native SVG ribbon icon and settings logo`, async () => {
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
            `const ribbon=document.querySelector('.annotate-ribbon'),svg=ribbon?.querySelector('svg.lucide-message-square-text'),image=document.querySelector('.vertical-tab-content .annotate-brand-heading img');await image?.decode();return !!svg&&!ribbon.querySelector('img')&&svg.getAttribute('stroke')==='currentColor'&&svg.getBoundingClientRect().width>0&&svg.getBoundingClientRect().height>0&&image?.naturalWidth>0&&image.src.startsWith('data:image/png;base64,')`,
          ),
          'ribbon uses a theme-aware SVG and the settings logo loads',
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
      `${P}return {name:p?.manifest.name,v:p?.manifest.version,codex:p?.data.codex?.enabled,css:[...document.styleSheets].some(x=>{try{return [...x.cssRules].some(r=>r.selectorText?.includes('.annotate-panel'))}catch{return false}})}`,
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
        `return Object.keys(app.commands.commands).filter(id=>id.startsWith('annotate:')&&id!=='annotate:sync-local-build').length===4`,
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
if (only.includes('logos'))
  for (const theme of themes)
    for (const mode of modes) {
      await step(
        `logos [${mode}/${theme}]: distinct assistant avatars and mention icons`,
        async () => {
          await resetThreads();
          await ev(
            `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
          );
          await createComment(mode, 'Assistant logo fixture');
          await ev(
            `${P}const t=p.data.threads.at(-1);for(const provider of ['chatgpt','claude'])t.comments.push({id:crypto.randomUUID(),author:provider,role:'assistant',provider,body:'Synthetic '+provider+' reply',status:'completed',createdAt:Date.now()});p.openThread(t)`,
          );
          assert(
            await ev(
              `const icons=[...document.querySelectorAll('.annotate-avatar-ai svg')];return icons.length===2&&icons[0].classList.contains('annotate-openai-icon')&&icons[1].classList.contains('annotate-claude-icon')&&icons[0].querySelector('path').getAttribute('d')!==icons[1].querySelector('path').getAttribute('d')&&getComputedStyle(icons[1]).color==='rgb(217, 119, 87)'`,
            ),
            'assistant avatars use different marks',
          );
          await shot(`logos-${mode}-${theme}-thread`);
          await ev(`document.querySelector('.annotate-composer textarea').focus()`);
          await type('@');
          assert(
            await ev(
              `const menu=document.querySelector('.annotate-mention-menu');return !menu.hidden&&menu.querySelectorAll('.annotate-assistant-icon').length===2&&getComputedStyle(menu.querySelector('.annotate-claude-icon')).color==='rgb(217, 119, 87)'`,
            ),
            'mention menu shows both provider logos',
          );
          await shot(`logos-${mode}-${theme}-mention`);
          await press('Escape');
          await ev(`${P}p.closePopup()`);
        },
      );
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

if (only.includes('polish'))
  for (const m of modes)
    await step(`polish [${m}]: draft, active highlight, undo, list keyboard, exit`, async () => {
      await resetThreads();
      await createComment(m, 'polish comment');
      const id = await ev(`${P}return p.data.threads[0].id`);
      await until(
        `return !!document.querySelector('.annotate-highlight.annotate-is-active')`,
        'open thread highlight is active',
      );
      await hoverComposer();
      await type('unsent polish draft');
      await ev(`${P}p.closePopup()`);
      await until(
        `return !document.querySelector('.annotate-panel')&&!document.querySelector('.annotate-highlight.annotate-is-active')`,
        'popover exit finishes and active highlight clears',
      );
      await ev(`${P}p.openThread(p.data.threads[0])`);
      await until(
        `return document.querySelector('.annotate-composer textarea')?.value==='unsent polish draft'`,
        'unsent reply draft restored',
      );
      await ev(`${P}p.closePopup()`);
      await ev(`app.commands.executeCommandById('annotate:show-comment-threads')`);
      await until(
        `return document.activeElement?.classList.contains('annotate-thread-row')`,
        'first list row focused',
      );
      await press('Enter');
      await until(
        `return document.querySelector('.annotate-popover .annotate-quote')&&!document.querySelector('.modal-container')`,
        'Enter on a row opens the thread',
      );
      assert(
        (await ev(
          `return document.querySelectorAll('.annotate-highlight.annotate-pulse').length`,
        )) > 0 || m === 'reading',
        'revealed highlight pulses',
      );
      await ev(`document.querySelector('.annotate-popover .annotate-delete').click()`);
      await until(
        `${P}return !p.data.threads.length&&!!document.querySelector('.annotate-toast-undo')`,
        'one click deletes and offers Undo',
      );
      await ev(`document.querySelector('.annotate-toast-undo').click()`);
      await until(
        `${P}return p.data.threads[0]?.id===${JSON.stringify(id)}&&!document.querySelector('.annotate-toast')`,
        'Undo restores the thread',
      );
    });

if (only.includes('ui') || only.includes('fullscreen'))
  for (const theme of themes)
    for (const mode of modes)
      await step(
        `fullscreen [${mode}/${theme}]: expand, draft, edit, stream, restore and resolve`,
        async () => {
          await resetThreads();
          await ev(
            `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
          );
          await createComment(mode, 'Fullscreen comment');
          await type('Unsent fullscreen reply');
          await ev(
            `window.annotateFullscreenPanel=document.querySelector('.annotate-popover');window.annotateFullscreenDraft=document.querySelector('.annotate-composer textarea');document.querySelector('.annotate-message-edit').click();window.annotateFullscreenEdit=document.querySelector('.annotate-message-editor textarea');window.annotateFullscreenEdit.value='Unsent edit';document.querySelector('.annotate-expand').click()`,
          );
          await until(
            `const p=document.querySelector('.annotate-fullscreen'),r=p?.getBoundingClientRect();return r&&r.x===0&&r.y===0&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1`,
            'thread covers the application viewport',
          );
          assert(
            await ev(
              `return document.querySelector('.annotate-popover')===window.annotateFullscreenPanel&&document.querySelector('.annotate-composer textarea')===window.annotateFullscreenDraft&&window.annotateFullscreenDraft.value==='Unsent fullscreen reply'&&document.querySelector('.annotate-message-editor textarea')===window.annotateFullscreenEdit&&window.annotateFullscreenEdit.value==='Unsent edit'&&document.querySelector('.annotate-expand').getAttribute('aria-pressed')==='true'`,
            ),
            'expand preserves draft and edit DOM',
          );
          await ev(
            `${P}p.data.threads[0].comments.push({id:'fullscreen-stream',author:'ChatGPT',role:'assistant',status:'streaming',body:'**Streaming** reply',createdAt:Date.now()});p.paintCodex()`,
          );
          await until(
            `return document.querySelector('.annotate-fullscreen [data-message-id="fullscreen-stream"] .annotate-message-body strong')?.textContent==='Streaming'`,
            'response renders in expanded thread',
          );
          await shot(`fullscreen-${mode}-${theme}`);
          await ev(`document.querySelector('.annotate-expand').focus()`);
          await press('Escape');
          await until(
            `return !!document.querySelector('.annotate-popover')&&!document.querySelector('.annotate-fullscreen')`,
            'Escape restores popup without closing',
          );
          assert(
            await ev(
              `return document.querySelector('.annotate-popover')===window.annotateFullscreenPanel&&window.annotateFullscreenDraft.value==='Unsent fullscreen reply'&&window.annotateFullscreenEdit.value==='Unsent edit'&&document.querySelector('.annotate-expand').getAttribute('aria-pressed')==='false'`,
            ),
            'restore preserves draft and edit',
          );
          await ev(
            `document.querySelector('.annotate-expand').click();document.querySelector('.annotate-resolve').click()`,
          );
          await until(
            `return !!document.querySelector('.annotate-fullscreen .annotate-resolved-banner')`,
            'resolved thread stays expanded',
          );
          await ev(`document.querySelector('.annotate-resolve').click()`);
          await until(
            `return !!document.querySelector('.annotate-fullscreen .annotate-composer')`,
            'reopened thread stays expanded',
          );
          await ev(`document.querySelector('.annotate-expand').click()`);
          await until(
            `return !!document.querySelector('.annotate-popover')&&!document.querySelector('.annotate-fullscreen')`,
            'restore button returns to popup',
          );
          await ev(
            `document.querySelector('.annotate-expand').click();document.querySelector('.annotate-close').click();delete window.annotateFullscreenPanel;delete window.annotateFullscreenDraft;delete window.annotateFullscreenEdit`,
          );
          await until(
            `return !document.querySelector('.annotate-panel')`,
            'close removes expanded thread',
          );
        },
      );

if (only.includes('scroll'))
  for (const theme of themes)
    for (const mode of modes)
      await step(
        `scroll [${mode}/${theme}]: streamed text preserves the reading position`,
        async () => {
          await ev(
            `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
          );
          await resetThreads();
          await createComment(mode, 'Explain this synthetic passage');
          await ev(
            `${P}const t=p.data.threads[0];t.comments.push({id:'scroll-stream',author:'ChatGPT',role:'assistant',status:'streaming',body:Array.from({length:50},(_,i)=>'Paragraph '+i+' of the streamed answer.').join('\\n\\n'),createdAt:Date.now()});p.paintCodex()`,
          );
          await until(
            `return document.querySelector('[data-message-id="scroll-stream"] .annotate-message-body')?.textContent.includes('Paragraph 49')`,
            'long streamed response rendered',
          );
          let chunk = 0;
          for (const expanded of [false, true]) {
            if (expanded) await ev(`document.querySelector('.annotate-expand').click()`);
            for (const fraction of [0, 0.5, 1]) {
              const before = await ev(
                `const l=document.querySelector('.annotate-messages');if(l.scrollHeight<=l.clientHeight)throw Error('Response must overflow');l.scrollTop=(l.scrollHeight-l.clientHeight)*${fraction};return l.scrollTop`,
              );
              const marker = `Stream chunk ${++chunk}`;
              await ev(
                `${P}const c=p.data.threads[0].comments.at(-1);c.body+='\\n\\n'+${JSON.stringify(marker)}+'\\n\\n'+Array(10).fill('New text arriving while the reader stays here.').join('\\n\\n');p.paintCodex()`,
              );
              await until(
                `return document.querySelector('[data-message-id="scroll-stream"] .annotate-message-body')?.textContent.includes(${JSON.stringify(marker)})`,
                'next streamed chunk rendered',
              );
              assert(
                await ev(
                  `return Math.abs(document.querySelector('.annotate-messages').scrollTop-${before})<1`,
                ),
                `reading position moved at ${fraction}, fullscreen=${expanded}`,
              );
            }
          }
          const before = await ev(`return document.querySelector('.annotate-messages').scrollTop`);
          await ev(`${P}p.data.threads[0].comments.at(-1).status='completed';p.paintCodex()`);
          assert(
            await ev(
              `return Math.abs(document.querySelector('.annotate-messages').scrollTop-${before})<1`,
            ),
            'completing the response moved the reading position',
          );
        },
      );

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
        assert(
          await ev(
            `const ai=document.querySelector('.annotate-message-ai'),user=document.querySelector('.annotate-message:not(.annotate-message-ai)');return !!ai&&!!user&&getComputedStyle(ai).backgroundColor===getComputedStyle(user).backgroundColor`,
          ),
          'assistant messages use the same background as ordinary comments',
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

if (only.includes('preview')) {
  for (const mode of modes.filter((mode) => mode !== 'reading')) {
    await step(
      `preview [${mode}]: editing skips hidden sections, showing Reading applies pending changes`,
      async () => {
        await resetThreads();
        await createComment('reading', 'Hidden preview refresh');
        await ev(`${P}p.closePopup()`);
        await openMode(mode);
        await ev(
          `${P}const sections=[...p.readingSections.values()].filter(s=>s.path===${JSON.stringify(NOTE)}&&s.root.isConnected);if(!sections.length||sections.some(s=>s.root.isShown()))throw Error('Expected connected hidden preview');window.annotatePreviewProbe={render:p.renderReadingSection,calls:0,roots:sections.map(s=>({root:s.root,html:s.root.innerHTML}))};p.renderReadingSection=function(section){if(!section.root.isShown())window.annotatePreviewProbe.calls++;return window.annotatePreviewProbe.render.call(this,section)};const editor=app.workspace.activeLeaf.view.editor;editor.focus();editor.setCursor(editor.offsetToPos(editor.getValue().length))`,
        );
        try {
          for (let i = 0; i < 3; i++) {
            await type('x');
            await press('Backspace');
          }
          await ev(
            `${P}p.openThread(p.data.threads[0]);p.popup.querySelector('.annotate-resolve').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
          );
          assert(
            await ev(
              `return window.annotatePreviewProbe.calls===0&&window.annotatePreviewProbe.roots.every(({root,html})=>root.innerHTML===html)`,
            ),
            'typing and resolving do not rebuild hidden preview sections',
          );
          await openMode('reading');
          await until(
            `return app.workspace.activeLeaf.view.previewMode.containerEl.querySelectorAll('.annotate-reading-count').length===0`,
            'resolved annotation disappears when Reading becomes visible',
          );
        } finally {
          await ev(
            `${P}p.renderReadingSection=window.annotatePreviewProbe.render;delete window.annotatePreviewProbe`,
          );
        }
      },
    );
  }
  await step('preview: hidden Reading tab catches up when activated', async () => {
    await resetThreads();
    await createComment('reading', 'Background tab refresh');
    await ev(
      `${P}p.closePopup();window.annotatePreviewLeaf=app.workspace.activeLeaf;const other=app.workspace.getLeaf('tab');await other.openFile(app.vault.getFileByPath('Fixtures/Mentions.md'));app.workspace.setActiveLeaf(other,{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
    );
    try {
      const visibility = await ev(
        `${P}const root=window.annotatePreviewLeaf.view.previewMode.containerEl;return {shown:root.isShown(),sections:[...p.readingSections.values()].filter(s=>root.contains(s.root)&&s.root.isConnected).length}`,
      );
      assert(!visibility.shown, `Reading tab must be hidden: ${JSON.stringify(visibility)}`);
      const hiddenMarkup = await ev(
        `return window.annotatePreviewLeaf.view.previewMode.containerEl.innerHTML`,
      );
      await ev(
        `${P}p.data.threads[0].comments.push({id:'hidden-tab-reply',author:'Synthetic',body:'A background reply',createdAt:1});p.changed();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
      );
      assert(
        (await ev(`return window.annotatePreviewLeaf.view.previewMode.containerEl.innerHTML`)) ===
          hiddenMarkup,
        'hidden tab does not rebuild its markup for a comment update',
      );
      await ev(`app.workspace.setActiveLeaf(window.annotatePreviewLeaf,{focus:true})`);
      await until(
        `return window.annotatePreviewLeaf.view.previewMode.containerEl.querySelector('.annotate-reading-count')?.textContent==='2'`,
        'activated Reading tab shows the pending reply count',
      );
    } finally {
      await ev(`delete window.annotatePreviewLeaf`);
    }
  });
  await step(
    'preview: visible inactive Reading split updates while editing another pane',
    async () => {
      await resetThreads();
      await createComment('reading', 'Visible split refresh');
      await ev(
        `${P}p.closePopup();window.annotatePreviewLeaf=app.workspace.activeLeaf;const split=app.workspace.getLeaf('split','vertical');await split.setViewState({type:'markdown',state:{file:${JSON.stringify(NOTE)},mode:'source',source:false}});app.workspace.setActiveLeaf(split,{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
      );
      try {
        assert(
          await ev(
            `return app.workspace.activeLeaf!==window.annotatePreviewLeaf&&window.annotatePreviewLeaf.view.previewMode.containerEl.isShown()`,
          ),
          'inactive Reading split remains visible',
        );
        await ev(
          `${P}p.openThread(p.data.threads[0]);document.querySelector('.annotate-composer textarea').focus()`,
        );
        await type('Reply from the editor split');
        await press('Enter');
        await until(
          `return window.annotatePreviewLeaf.view.previewMode.containerEl.querySelector('.annotate-reading-count')?.textContent==='2'`,
          'visible Reading split receives the new reply count',
        );
      } finally {
        await ev(
          `${P}p.closePopup();window.annotatePreviewLeaf.detach();delete window.annotatePreviewLeaf`,
        );
      }
    },
  );
}

if (only.includes('memory')) {
  for (const mode of modes) {
    await step(
      `memory [${mode}]: split views keep note text, last close releases it, reopen restores comments`,
      async () => {
        await resetThreads();
        await createComment(mode, 'Saved comment survives cache eviction');
        await ev(`${P}p.closePopup()`);
        const before = await ev(`${P}await p.persist();return JSON.stringify(p.data.threads)`);
        await ev(
          `const first=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(NOTE)});const second=app.workspace.getLeaf('split','vertical');await second.setViewState({type:'markdown',state:{file:${JSON.stringify(NOTE)},mode:${JSON.stringify(mode === 'reading' ? 'preview' : 'source')},source:${mode === 'source'}}});app.workspace.setActiveLeaf(second,{focus:true});first.detach()`,
        );
        await until(
          `${P}return p.documents.has(${JSON.stringify(NOTE)})`,
          'split retains note text',
        );
        await ev(
          `const closing=app.workspace.getLeavesOfType('markdown').filter(leaf=>leaf.view.file?.path===${JSON.stringify(NOTE)});const other=app.workspace.getLeaf('tab');await other.openFile(app.vault.getFileByPath('Fixtures/Mentions.md'));app.workspace.setActiveLeaf(other,{focus:true});for(const leaf of closing)leaf.detach()`,
        );
        await until(`${P}return !p.documents.has(${JSON.stringify(NOTE)})`, 'closed note evicted');
        assert(
          (await ev(`${P}return JSON.stringify(p.data.threads)`)) === before,
          'cache eviction preserves saved comments and anchors',
        );
        await openMode(mode);
        await until(
          `return [...document.querySelectorAll('.annotate-count')].some(el=>el.textContent.includes('1'))`,
          'reopened note has its comment badge',
        );
        await ev(`${P}p.openThread(p.data.threads[0])`);
        await until(
          `return document.querySelector('.annotate-message-body')?.textContent==='Saved comment survives cache eviction'`,
          'reopened comment body',
        );
        await ev(`${P}p.closePopup()`);
      },
    );
  }
  await step(
    'memory: disable releases note and draft caches while saved comments survive reload',
    async () => {
      const before = await ev(`${P}await p.persist();return JSON.stringify(p.data.threads)`);
      try {
        await ev(
          `${P}window.annotateMemoryUnloaded=p;p.drafts.set('synthetic-memory-draft','Unsent synthetic draft');await app.plugins.disablePlugin('annotate');await p.saveQueue`,
        );
        assert(
          await ev(
            `return window.annotateMemoryUnloaded.documents.size===0&&window.annotateMemoryUnloaded.drafts.size===0`,
          ),
          'disabled instance releases its ephemeral note and draft text',
        );
        await ev(`await app.plugins.enablePlugin('annotate')`);
        const after = await ev(`${P}return JSON.stringify(p.data.threads)`);
        assert(
          isDeepStrictEqual(JSON.parse(after), JSON.parse(before)),
          `cache cleanup on disable preserves persisted comments: ${before} -> ${after}`,
        );
      } finally {
        await ev(`delete window.annotateMemoryUnloaded`);
      }
    },
  );
}

if (only.includes('resources')) {
  const { checkResources } = await import('./resource-checks.mjs');
  await checkResources({ ev, step, until, assert, createComment, modes, themes });
}

if (only.includes('access')) {
  const { checkAccess } = await import('./access-checks.mjs');
  await checkAccess({ ev, step, until, assert, shot, press, themes });
}

if (only.includes('providers') || only.includes('claude-live')) {
  const { checkProviders } = await import('./provider-checks.mjs');
  await checkProviders({
    only,
    modes,
    themes,
    root,
    plugin: PLUGIN,
    ev,
    step,
    until,
    resetThreads,
    createComment,
    openComposer,
    type,
    press,
    assert,
    shot,
  });
}

if (only.includes('distribution')) {
  await step('distribution: development Sync controls are absent', async () => {
    await ev(
      `const settings=app.setting,previous=settings.shouldUsePopout;try{settings.shouldUsePopout=()=>false;settings.open();settings.openTabById('annotate')}finally{settings.shouldUsePopout=previous}`,
    );
    await until(
      `return !!document.querySelector('.annotate-settings-advanced')`,
      'settings rendered',
    );
    assert(
      await ev(
        `return !app.commands.commands['annotate:sync-local-build']&&!document.querySelector('.vertical-tab-content').textContent.includes('Local development build')&&![...document.querySelectorAll('.setting-item button')].some(b=>b.textContent==='Sync')`,
      ),
      'distribution must not expose development Sync',
    );
    await ev(`app.setting.close()`);
  });
}

if (only.includes('sync')) {
  await step('sync: settings button reloads local build and preserves comments', async () => {
    await ev(
      `const settings=app.setting,previous=settings.shouldUsePopout;try{settings.shouldUsePopout=()=>false;settings.open();settings.openTabById('annotate')}finally{settings.shouldUsePopout=previous}`,
    );
    await until(
      `return [...document.querySelectorAll('.setting-item button')].some(b=>b.textContent==='Sync')`,
      'Sync button rendered',
    );
    await ev(`document.querySelector('.annotate-settings-advanced').open=true`);
    const before = await ev(
      `${P}p.localBuildDirectory=${JSON.stringify(join(PLUGIN, '.development'))};await p.persist();window.annotateBeforeSync=p;return JSON.stringify(p.data.threads)`,
    );
    const point = await ev(
      `const button=[...document.querySelectorAll('.setting-item button')].find(b=>b.textContent==='Sync');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]`,
    );
    await clickAt(point);
    await until(
      `return app.plugins.plugins.annotate && app.plugins.plugins.annotate!==window.annotateBeforeSync && !window.annotateBeforeSync.syncing`,
      'new plugin loaded by Sync',
    );
    assert(
      await ev(
        `return [...document.querySelectorAll('.notice')].some(n=>n.textContent.includes('synced and reloaded'))`,
      ),
      'sync success notice visible',
    );
    const after = await ev(`${P}return JSON.stringify(p.data.threads)`);
    assert(
      isDeepStrictEqual(JSON.parse(after), JSON.parse(before)),
      `comments survive sync: ${before} -> ${after}`,
    );
    assert(
      (await ev(
        `return Object.keys(app.commands.commands).filter(id=>id==='annotate:sync-local-build').length`,
      )) === 1,
      'sync command registered once',
    );
    assert(
      await ev(
        `return !!document.querySelector('.annotate-settings-advanced')&&document.querySelector('.vertical-tab-content').textContent.includes('Automatic local updates enabled')`,
      ),
      'Sync preserves the open Annotate settings tab',
    );
    await ev(`delete window.annotateBeforeSync;app.setting.close()`);
  });
  await step('sync: missing build reports failure and keeps plugin loaded', async () => {
    await ev(
      `${P}window.annotateBeforeSync=p;p.localBuildDirectory='/missing/annotate-build';await p.syncBuild()`,
    );
    assert(
      (await ev(`${P}return p===window.annotateBeforeSync && !p.syncing`)) === true,
      'failed sync keeps current instance',
    );
    assert(
      await ev(
        `return [...document.querySelectorAll('.notice')].some(n=>n.textContent.includes('Annotate update failed'))`,
      ),
      'failure notice visible',
    );
    await ev(
      `${P}p.localBuildDirectory=${JSON.stringify(join(PLUGIN, '.development'))};await p.persist();delete window.annotateBeforeSync`,
    );
  });
}

if (only.includes('auto-update')) {
  await step(
    'auto-update: defer during comment, reload while idle, retain settings and drafts',
    async () => {
      const { publishDevelopmentBuild } = await import('../scripts/development-build.mjs');
      const directory = join(PLUGIN, '.development');
      const originals = ['main.js', 'manifest.json', 'styles.css'].map((name) =>
        readFileSync(join(directory, name), 'utf8'),
      );
      let changed = false;
      try {
        await resetThreads();
        await createComment('live', 'Synthetic saved development comment');
        const before = await ev(
          `${P}window.annotateBeforeAuto=p;p.drafts.set('synthetic-dev-draft','Unsent synthetic draft');await p.persist();return JSON.stringify(p.data)`,
        );
        const next = [
          originals[0] + '\n// synthetic automatic update check',
          originals[1],
          originals[2],
        ];
        publishDevelopmentBuild(directory, next);
        changed = true;
        await sleep(1400);
        assert(
          await ev(`${P}return p===window.annotateBeforeAuto`),
          'an open comment defers reload',
        );
        await ev(
          `${P}p.closePopup();document.activeElement?.blur();const s=app.setting,previous=s.shouldUsePopout;try{s.shouldUsePopout=()=>false;s.open();s.openTabById('annotate')}finally{s.shouldUsePopout=previous}`,
        );
        await until(
          `${P}return p!==window.annotateBeforeAuto&&!window.annotateBeforeAuto.syncing&&!!p.stopDevelopmentUpdates`,
          'new development build loads automatically',
          7000,
        );
        const preserved = await ev(
          `${P}return {data:p.data,draft:p.drafts.get('synthetic-dev-draft')}`,
        );
        assert(
          isDeepStrictEqual(preserved.data, JSON.parse(before)) &&
            preserved.draft === 'Unsent synthetic draft',
          'automatic reload preserves saved settings, comments and unsent drafts',
        );
        assert(
          await ev(
            `return document.querySelector('.vertical-tab-content')?.textContent.includes('Automatic local updates enabled')&&!!document.querySelector('.annotate-settings-advanced')`,
          ),
          'Annotate settings stay selected after auto-update',
        );
        assert(
          await ev(`return !!app.commands.commands['annotate:sync-local-build']`),
          'development controls survive update',
        );
        await shot('development-auto-update-settings');
        await ev(`${P}window.annotateAfterAuto=p`);
        await sleep(1400);
        assert(
          await ev(`${P}return p===window.annotateAfterAuto`),
          'unchanged build does not reload repeatedly',
        );
      } finally {
        await ev(`${P}p.closePopup();app.setting.close();document.activeElement?.blur()`);
        if (changed) {
          await ev(`${P}window.annotateBeforeRestore=p`);
          publishDevelopmentBuild(directory, originals);
          await until(
            `${P}return p!==window.annotateBeforeRestore`,
            'original development artifact restored',
            7000,
          );
        }
        await ev(
          `${P}p.drafts.delete('synthetic-dev-draft');await p.persist();delete window.annotateBeforeAuto;delete window.annotateAfterAuto;delete window.annotateBeforeRestore`,
        );
      }
    },
  );
}

if (only.includes('storage')) {
  await step(
    'storage: external comments reload and survive subsequent saves and reload',
    async () => {
      await resetThreads();
      await createComment('live', 'Original synthetic comment');
      await ev(
        `${P}p.closePopup();await p.persist();const external=await p.loadData();const remote=structuredClone(external.threads[0]);remote.id='remote-sync-thread';remote.comments=[{id:'remote-sync-comment',author:'Remote',body:'Synced synthetic comment',createdAt:Date.now()}];external.threads.push(remote);const path=require('node:path').join(app.vault.adapter.getBasePath(),p.manifest.dir,'data.json');require('node:fs').writeFileSync(path,JSON.stringify(external));`,
      );
      await until(
        `${P}return p.data.threads.some(t=>t.id==='remote-sync-thread')`,
        'external-settings notification reloads the synced thread',
        7000,
      );
      assert(
        await ev(
          `${P}p.data.author='Local after sync';await p.persist();const disk=await p.loadData();return disk.threads.length===2&&disk.threads.some(t=>t.id==='remote-sync-thread')&&disk.author==='Local after sync'&&!p.conflictBackup`,
        ),
        'a local save must retain the externally added comment',
      );
      await ev(
        `await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
      );
      assert(
        await ev(
          `${P}const remote=p.data.threads.find(t=>t.id==='remote-sync-thread');if(!remote)return false;p.openThread(remote);return p.data.threads.length===2&&remote.comments[0].body==='Synced synthetic comment'`,
        ),
        'both threads survive plugin reload',
      );
      await until(
        `return document.querySelector('.annotate-message-body')?.textContent==='Synced synthetic comment'`,
        'synced comment renders after reload',
      );
    },
  );
  await step(
    'storage: sync leaves an unsaved message edit open until the thread closes',
    async () => {
      await ev(
        `${P}p.closePopup();p.openThread(p.data.threads.find(t=>t.id!=='remote-sync-thread'));document.querySelector('.annotate-message-edit').click();const input=document.querySelector('.annotate-message-editor textarea');input.value='Unsent synthetic edit';input.dispatchEvent(new Event('input',{bubbles:true}));const external=await p.loadData();external.author='Remote while editing';const path=require('node:path').join(app.vault.adapter.getBasePath(),p.manifest.dir,'data.json');require('node:fs').writeFileSync(path,JSON.stringify(external));await p.onExternalSettingsChange();`,
      );
      assert(
        await ev(
          `${P}return document.querySelector('.annotate-message-editor textarea')?.value==='Unsent synthetic edit'&&p.data.author==='Local after sync'&&(await p.loadData()).author==='Remote while editing'`,
        ),
        'sync must not close or replace an unsaved message editor',
      );
      assert(
        await ev(
          `${P}p.closePopup();await p.onExternalSettingsChange();const updated=p.data.author==='Remote while editing';p.data.author='Local after sync';await p.persist();return updated&&!p.conflictBackup`,
        ),
        'closing the thread applies the deferred sync and resumes normal saves',
      );
    },
  );
  await step(
    'storage: conflicting copies are recoverable and synced data survives reload',
    async () => {
      try {
        assert(
          await ev(
            `${P}p.closePopup();await p.persist();const external=await p.loadData();external.threads[0].comments[0].body='Remote conflicting comment';p.data.threads[0].comments[0].body='Local conflicting comment';const path=require('node:path').join(app.vault.adapter.getBasePath(),p.manifest.dir,'data.json');require('node:fs').writeFileSync(path,JSON.stringify(external));await p.persist();window.annotateStorageRecovery=p.conflictBackup;const disk=await p.loadData();const recovery=JSON.parse(await app.vault.adapter.read(p.conflictBackup));return disk.threads[0].comments[0].body==='Remote conflicting comment'&&recovery.local.threads[0].comments[0].body==='Local conflicting comment'&&recovery.external.threads[0].comments[0].body==='Remote conflicting comment'`,
          ),
          'save preflight preserves both conflicting comments and leaves synced data untouched',
        );
        assert(
          await ev(
            `${P}p.data.author='Later unsaved local name';await p.persist();const recovery=JSON.parse(await app.vault.adapter.read(p.conflictBackup));return recovery.local.author==='Later unsaved local name'&&(await p.loadData()).author==='Local after sync'`,
          ),
          'paused saves keep later local changes in the recovery file',
        );
        await ev(
          `await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
        );
        assert(
          await ev(
            `${P}await p.persist();const recovery=JSON.parse(await app.vault.adapter.read(window.annotateStorageRecovery));return !p.conflictBackup&&p.data.threads.length===2&&p.data.threads[0].comments[0].body==='Remote conflicting comment'&&recovery.local.threads[0].comments[0].body==='Local conflicting comment'`,
          ),
          'reload resumes normal saves without losing either conflicting copy',
        );
      } finally {
        await ev(
          `if(window.annotateStorageRecovery){await app.vault.adapter.remove(window.annotateStorageRecovery);delete window.annotateStorageRecovery}`,
        );
      }
    },
  );
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

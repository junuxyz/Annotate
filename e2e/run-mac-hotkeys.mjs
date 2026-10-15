// CDP_PORT and ANNOTATE_PROFILE must identify this run's isolated hidden test-vault.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as h from './e2e.mjs';

if (
  process.platform !== 'darwin' ||
  !process.env.ANNOTATE_PROFILE ||
  !process.env.ANNOTATE_ONSCREEN_CHECK
)
  throw new Error('Use a dedicated hidden macOS profile and compiled onscreen.swift checker.');
const { ev, send, check, P, CMD, SHIFT } = h;
const output = resolve(process.env.E2E_OUTPUT || 'e2e/evidence/mac-hotkeys');
mkdirSync(output, { recursive: true });
const info = await ev(
  `const r=require('@electron/remote');return {pid:r.process.pid,profile:r.app.getPath('userData'),vault:app.vault.getName(),platform:process.platform,version:document.title.match(/Obsidian ([0-9.]+)/)?.[1]??r.app.getVersion(),launcherVersion:r.app.getVersion(),mac:process.platform==='darwin'}`,
);
if (
  realpathSync(info.profile) !== realpathSync(process.env.ANNOTATE_PROFILE) ||
  info.vault !== 'test-vault' ||
  !info.mac
)
  throw new Error('Refusing to drive an unrelated Obsidian instance: ' + JSON.stringify(info));
let visible = false,
  samples = 0;
const sample = () => {
  const windows = execFileSync(process.env.ANNOTATE_ONSCREEN_CHECK, { encoding: 'utf8' });
  visible ||= new RegExp(`\\bpid ${info.pid}\\b`).test(windows);
  samples++;
};
sample();
const monitor = setInterval(sample, 150);
const until = async (code, label) => {
  const end = Date.now() + 5000;
  while (!(await ev(code))) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await h.sleep(50);
  }
};
const key = async (letter) => {
  const params = {
    key: letter,
    code: `Key${letter.toUpperCase()}`,
    windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0),
    modifiers: CMD | SHIFT,
  };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
};
const note = 'Fixtures/Annotations.md',
  quote = 'Boundary target: violet flower.';
const original = await ev(
  `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(note)}))`,
);
try {
  await ev(
    `const trust=[...document.querySelectorAll('.modal-container button')].find(b=>b.textContent==='Trust author and enable plugins');trust?.click();app.setting.close();`,
  );
  await ev(`await app.plugins.setEnable(true);await app.plugins.enablePluginAndSave('annotate')`);
  await until(`${P}return !!p`, 'Annotate loaded');
  check(
    'macOS defaults use platform Mod for both shortcuts',
    await ev(
      `const commands=app.commands.commands;return ['highlight-selection','add-selection-comment'].every(id=>commands['annotate:'+id]?.hotkeys.some(h=>h.modifiers.includes('Mod')&&h.modifiers.includes('Shift')))`,
    ),
  );
  for (const mode of ['live', 'source', 'reading']) {
    await ev(
      `${P}p.closePopup();p.data.threads=[];p.data.highlights.recent='pink';await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(note)}),${JSON.stringify(original)})`,
    );
    await h.mode(mode);
    const select = async () => {
      await ev('document.activeElement?.blur()');
      if (mode === 'reading') await h.selectReading(quote);
      else await h.selectEditor(quote);
    };
    await select();
    await key('m');
    await until(
      `return document.activeElement===document.querySelector('.annotate-new-comment textarea')`,
      'Cmd Shift M composer',
    );
    check(`[${mode}] Cmd+Shift+M opens the Annotate composer`, true);
    await h.key('Escape');
    await until(
      `${P}return !p.refreshPending&&!document.querySelector('.annotate-is-closing')`,
      'composer closed',
    );
    await select();
    await until(
      `return document.querySelector('.annotate-selection-tools button')?.title.includes('⌘⇧H')`,
      'Mac tooltip',
    );
    check(
      `[${mode}] selection menu labels use Command`,
      await ev(
        `const b=[...document.querySelectorAll('.annotate-selection-tools button')];return b[0].title.includes('⌘⇧H')&&b.at(-1).title==='⌘⇧M'`,
      ),
    );
    await key('h');
    await until(
      `return app.vault.cachedRead(app.vault.getAbstractFileByPath(${JSON.stringify(note)})).then(s=>s.includes('data-annotate-highlight="pink"'))`,
      'Cmd Shift H applies last color',
    );
    check(`[${mode}] Cmd+Shift+H applies the most recent color`, true);
  }
  await ev(
    `${P}await p.persist();await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
  );
  check('last color survives reload', await ev(`${P}return p.data.highlights.recent==='pink'`));
} catch (error) {
  check('macOS hotkey run completed', false, error.message);
} finally {
  await ev(
    `${P}p?.closePopup();p?.hideSelectionTools();await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(note)}),${JSON.stringify(original)})`,
  );
  clearInterval(monitor);
  sample();
  check(
    'isolated Mac window stayed off screen during checks',
    !visible,
    `${samples} samples; startup hiding measured separately`,
  );
  const hashes = ['main.js', 'styles.css']
    .map((name) => `${name}: ${createHash('sha256').update(readFileSync(name)).digest('hex')}`)
    .join('\n');
  const report = `\n## ${new Date().toISOString()} — macOS Command shortcuts, development validation\n\nObsidian ${info.version} (launcher ${info.launcherVersion}), ${info.platform}; profile ${info.profile}\nStartup: ${process.env.ANNOTATE_STARTUP_NOTE || 'initial launch visibility not sampled; monitoring began after hidden launch'}\nCommand: node e2e/run-mac-hotkeys.mjs\n${hashes}\n\n${h.results.join('\n')}\n`;
  writeFileSync(join(output, 'Validation results.md'), report);
  appendFileSync('../test-vault/Validation results.md', report);
  process.exitCode = h.done() ? 1 : 0;
}

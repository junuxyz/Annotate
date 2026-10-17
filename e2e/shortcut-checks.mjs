export async function checkShortcuts({
  ev,
  step,
  until,
  press,
  modes,
  themes,
  shot,
  assert,
  createComment,
  select,
  resetThreads,
  closeModals,
}) {
  const P = `const p=app.plugins.plugins.annotate;`;
  const color = 'annotate:color-selection-text';
  const list = 'annotate:show-comment-threads';
  const row = (id) => `document.querySelector('.annotate-hotkey-setting[data-command="${id}"]')`;
  const openSettings = async () => {
    await ev(
      `const s=app.setting,previous=s.shouldUsePopout;try{s.shouldUsePopout=()=>false;s.open();s.openTabById('annotate')}finally{s.shouldUsePopout=previous}document.querySelector('.annotate-settings-advanced').open=true;document.querySelector('.annotate-hotkey-settings').scrollIntoView({block:'center'})`,
    );
    await until(
      `return document.querySelectorAll('.annotate-hotkey-setting').length>=4`,
      'shortcut controls',
    );
  };
  const begin = async (id, action = 'change') => {
    await ev(`${row(id)}.querySelector('.annotate-hotkey-${action}').click()`);
    await until(
      `return !!document.querySelector('.annotate-shortcut-recorder')`,
      'shortcut recorder',
    );
  };
  const recorded = async () =>
    until(`return !document.querySelector('.annotate-shortcut-recorder')`, 'shortcut saved');
  const originals = await ev(
    `return Object.fromEntries(Object.keys(app.commands.commands).filter(id=>id.startsWith('annotate:')).map(id=>[id,app.hotkeyManager.getHotkeys(id)??null]))`,
  );
  try {
    await step(
      'shortcuts: Advanced lists every Annotate command and fits both themes',
      async () => {
        for (const theme of themes) {
          await ev(
            `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
          );
          await openSettings();
          assert(
            await ev(
              `return ['annotate:add-selection-comment','annotate:highlight-selection','${color}','${list}'].every(id=>document.querySelector('.annotate-hotkey-setting[data-command="'+id+'"]'))`,
            ),
            'all command shortcuts must be editable',
          );
          assert(
            await ev(
              `return [...document.querySelectorAll('.annotate-hotkey-setting')].every(r=>r.scrollWidth<=r.clientWidth+1)`,
            ),
            'shortcut rows must not overflow',
          );
          await shot(`shortcuts-${theme}`);
        }
      },
    );
    await step(
      'shortcuts: record, reject conflicts, cancel, add, remove and reset native bindings',
      async () => {
        await begin(color);
        await press('j', 8 | 2 | 1);
        await recorded();
        assert(
          await ev(
            `return app.hotkeyManager.getHotkeys('${color}')[0].modifiers.includes('Alt')&&${row(color)}.textContent.includes('Cmd+Alt+Shift+J')`,
          ),
          'replacement must apply immediately',
        );
        await begin(color);
        await press('h', 8 | 2);
        await until(
          `return document.querySelector('.annotate-shortcut-recorder [role="status"]')?.textContent.includes('Already used by')`,
          'conflicting highlight binding rejected',
        );
        await press('Escape');
        assert(
          await ev(`return app.hotkeyManager.getHotkeys('${color}')[0].modifiers.includes('Alt')`),
          'cancelling must keep the earlier binding',
        );
        await begin(color, 'add');
        await press('j', 8 | 1);
        await recorded();
        assert(
          await ev(`return app.hotkeyManager.getHotkeys('${color}').length===2`),
          'additional bindings must be preserved',
        );
        await ev(`${row(color)}.querySelectorAll('.annotate-hotkey-remove')[1].click()`);
        await until(
          `return app.hotkeyManager.getHotkeys('${color}').length===1`,
          'one binding removed',
        );
        await ev(`${row(color)}.querySelector('.annotate-hotkey-remove').click()`);
        await until(
          `return app.hotkeyManager.getHotkeys('${color}').length===0&&${row(color)}.textContent.includes('Set shortcut')`,
          'shortcut disabled',
        );
        await ev(`${row(color)}.querySelector('.annotate-hotkey-reset').click()`);
        await until(
          `return app.hotkeyManager.getHotkeys('${color}')===undefined&&${row(color)}.textContent.includes('Set shortcut')`,
          'reset leaves command unassigned',
        );
        await begin(color, 'add');
        await press('j', 8 | 2 | 1);
        await recorded();
        await begin(list, 'add');
        await press('m', 8 | 2 | 1);
        await recorded();
        assert(
          await ev(
            `const keys=JSON.parse(await app.vault.adapter.read(app.vault.configDir+'/hotkeys.json'));return keys['${color}'][0].modifiers.includes('Alt')&&keys['${list}'].length===1`,
          ),
          'native hotkeys.json must contain both changes',
        );
      },
    );
    await step(
      'shortcuts: native settings changes and plugin reload preserve Advanced bindings',
      async () => {
        await ev(
          `app.setting.close();app.hotkeyManager.setHotkeys('annotate:highlight-selection',[{modifiers:['Mod','Alt','Shift'],key:'h'}]);await app.hotkeyManager.save();await app.hotkeyManager.load();await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
        );
        await openSettings();
        assert(
          await ev(
            `return ${row('annotate:highlight-selection')}.textContent.includes('Cmd+Alt+Shift+H')&&${row(color)}.textContent.includes('Cmd+Alt+Shift+J')`,
          ),
          'Advanced must reflect native changes after reload',
        );
        await ev(
          `${row('annotate:highlight-selection')}.querySelector('.annotate-hotkey-reset').click()`,
        );
        await until(
          `return app.hotkeyManager.getHotkeys('annotate:highlight-selection')===undefined`,
          'highlight default restored',
        );
        await ev(`app.setting.close()`);
      },
    );
    for (const mode of modes) {
      await step(
        `shortcuts [${mode}]: changed keys execute text color and thread-list commands`,
        async () => {
          await resetThreads();
          const original = await ev(
            `return await app.vault.read(app.vault.getAbstractFileByPath('Fixtures/Annotations.md'))`,
          );
          try {
            await createComment(mode, 'Shortcut synthetic comment');
            await ev(`${P}p.closePopup();p.data.highlights.textRecent='blue';await p.persist()`);
            await select(mode);
            await until(
              `return [...document.querySelectorAll('.annotate-selection-tools button')].some(b=>['Cmd','Alt','Shift','J'].every(key=>b.title.includes(key)))`,
              'selection hint must show the assigned shortcut',
            );
            await press('j', 8 | 2 | 1);
            await until(
              `return app.vault.cachedRead(app.vault.getAbstractFileByPath('Fixtures/Annotations.md')).then(s=>s.includes('data-annotate-color="blue"'))`,
              'custom text-color shortcut executes',
            );
            await press('m', 8 | 2 | 1);
            await until(
              `return !!document.querySelector('.annotate-thread-modal .annotate-thread-row')`,
              'assigned list shortcut executes',
            );
            await closeModals();
          } finally {
            await closeModals();
            await ev(
              `await app.vault.process(app.vault.getAbstractFileByPath('Fixtures/Annotations.md'),()=>${JSON.stringify(original)})`,
            );
          }
        },
      );
    }
  } finally {
    await closeModals();
    await ev(
      `app.setting.close();for(const [id,keys] of Object.entries(${JSON.stringify(originals)})){if(keys===null)app.hotkeyManager.removeHotkeys(id);else app.hotkeyManager.setHotkeys(id,keys)}await app.hotkeyManager.save()`,
    );
  }
}

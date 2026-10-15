// Real Obsidian checks use synthetic notes and never contact a provider or MCP endpoint.
export async function checkAccess({ ev, step, until, assert, shot, themes = ['light', 'dark'] }) {
  const P = `const p=app.plugins.plugins.annotate,s=window.__annotateAccessCheck;`;
  const folder = `Agent access fixtures ${Date.now()}`;
  const sibling = `${folder} sibling`;
  const path = `${folder}/Original.md`;
  const created = `${folder}/Created.md`;
  const original = 'Synthetic access boundary original.';
  const edited = 'Synthetic access boundary edited.';
  const button = async (selector, label) => {
    await ev(
      `const b=[...document.querySelectorAll(${JSON.stringify(selector + ' button')})].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()`,
    );
  };
  const call = (name, args, turn = 'group') =>
    ev(
      `${P}return await p.agentAccess.tools().find(t=>t.name===${JSON.stringify(name)}).execute(${JSON.stringify(args)},{threadId:s.folder,turnId:${JSON.stringify(turn)},signal:new AbortController().signal})`,
    );
  const pendingContext = async (target, key = 'context') => {
    await ev(
      `${P}s.${key}=null;p.agentAccess.ensureContext(${JSON.stringify(target)},'ChatGPT').then(v=>s.${key}=v,e=>s.${key}=String(e))`,
    );
    await until(
      `return !!document.querySelector('.annotate-access-prompt')`,
      'folder approval opens',
    );
  };
  const closeHistory = () =>
    ev(`document.querySelector('.annotate-operation-history .modal-close-button')?.click()`);
  await ev(
    `${P}if(s)throw Error('Access check already running');window.__annotateAccessCheck={folder:${JSON.stringify(folder)},sibling:${JSON.stringify(sibling)},previousAgent:structuredClone(p.data.agent)};const x=window.__annotateAccessCheck;p.data.codex.enabled=false;p.configureCodex();p.agentAccess.cancelApprovals();const notes=await p.agentAccess.notes();x.previousHistory=notes.history;x.notes=notes;p.data.agent={folders:[],webSearch:false,services:[],consentVersion:1};await p.persistOrThrow();await app.vault.createFolder(x.folder);await app.vault.createFolder(x.sibling);await app.vault.create(${JSON.stringify(path)},${JSON.stringify(original)});await app.vault.create(x.sibling+'/Other.md','Synthetic sibling secret');x.mount=document.body.createDiv({cls:'annotate-access-check-settings'});p.agentAccess.renderSettings(x.mount)`,
  );
  try {
    await step('access: defaults deny notes, web, and services', async () => {
      assert(
        await ev(
          `${P}return p.data.agent.folders.length===0&&!p.data.agent.webSearch&&p.data.agent.services.length===0`,
        ),
        'empty permission defaults',
      );
      let denied = false;
      try {
        await call('read_note', { path });
      } catch {
        denied = true;
      }
      assert(denied, 'ungranted read denied');
      assert(
        await ev(
          `${P}return s.mount.textContent.includes('Terminal access is unavailable')&&s.mount.querySelector('select').querySelector('option[value="'+s.folder+'"]')!==null`,
        ),
        'actual settings show terminal restriction and visible fixture folder',
      );
    });
    await step('access: settings folder approval cancels without granting', async () => {
      await ev(
        `${P}const select=s.mount.querySelector('select');select.value=s.folder;select.dispatchEvent(new Event('change'));[...s.mount.querySelectorAll('button')].find(b=>b.textContent==='Allow folder').click()`,
      );
      await until(
        `return !!document.querySelector('.annotate-access-prompt')`,
        'settings folder prompt',
      );
      assert(
        await ev(
          `return document.querySelector('.annotate-access-prompt').textContent.includes('without asking for each edit')`,
        ),
        'permission scope disclosed',
      );
      await button('.annotate-access-prompt', 'Cancel');
      await until(
        `return !document.querySelector('.annotate-access-prompt')`,
        'cancel closes folder prompt',
      );
      assert(await ev(`${P}return !p.data.agent.folders.length`), 'cancel keeps folders empty');
    });
    await step('access: note context requires explicit folder consent', async () => {
      await pendingContext(path);
      assert(
        await ev(
          `return document.querySelector('.annotate-access-preview').textContent.includes(${JSON.stringify(path)})&&document.querySelector('.annotate-access-preview').textContent.includes('complete current note')&&document.querySelector('.annotate-access-preview').textContent.includes('@comment')`,
        ),
        'full context categories and note disclosed',
      );
      for (const theme of themes) {
        await ev(`app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`);
        await shot(`access-context-${theme}`);
      }
      await button('.annotate-access-prompt', 'Cancel');
      await until(`${P}return s.context===false`, 'context denied');
      await pendingContext(path);
      await button('.annotate-access-prompt', 'Allow folder');
      await until(`${P}return s.context===true`, 'context granted');
      assert(
        await ev(
          `${P}const disk=await p.loadData();return p.data.agent.folders.includes(s.folder)&&disk.agent.folders.includes(s.folder)`,
        ),
        'specific folder grant persisted',
      );
      assert(
        await ev(`${P}return await p.agentAccess.ensureContext(${JSON.stringify(path)},'ChatGPT')`),
        'same folder needs no repeated prompt',
      );
    });
    await step(
      'access: real filesystem tools reject sibling, hidden, and configuration paths',
      async () => {
        assert((await call('read_note', { path })).content === original, 'permitted note readable');
        for (const deniedPath of [
          `${sibling}/Other.md`,
          '.obsidian/plugins/annotate/data.md',
          `${folder}/.secret.md`,
          `${folder}/../Other.md`,
          `${folder}/%2e%2e/Other.md`,
          '/tmp/private.md',
        ]) {
          for (const [name, args] of [
            ['read_note', { path: deniedPath }],
            ['create_note', { path: deniedPath, content: 'Denied fixture' }],
            ['edit_note', { path: deniedPath, content: 'Denied fixture', expectedContent: '' }],
            ['delete_note', { path: deniedPath, expectedContent: '' }],
          ]) {
            let denied = false;
            try {
              await call(name, args, 'denied');
            } catch {
              denied = true;
            }
            assert(denied, `${name} denied ${deniedPath}`);
          }
        }
        const matches = await call('search_notes', { query: 'Synthetic' });
        assert(
          matches.paths.includes(path) && matches.paths.every((p) => p.startsWith(folder + '/')),
          'search never returns sibling paths',
        );
        assert(
          await ev(
            `${P}return (await app.vault.read(app.vault.getAbstractFileByPath(s.sibling+'/Other.md')))==='Synthetic sibling secret'`,
          ),
          'sibling fixture untouched',
        );
      },
    );
    await step('access: filesystem links cannot bypass folder boundaries', async () => {
      await ev(
        `${P}const fs=require('node:fs'),path=require('node:path');s.links=[path.join(app.vault.adapter.getBasePath(),s.folder,'Linked.md'),path.join(app.vault.adapter.getBasePath(),s.folder,'Hardlinked.md')];const target=path.join(app.vault.adapter.getBasePath(),s.sibling,'Other.md');fs.symlinkSync(target,s.links[0]);fs.linkSync(target,s.links[1])`,
      );
      for (const name of ['Linked.md', 'Hardlinked.md']) {
        let denied = false;
        try {
          await call('read_note', { path: `${folder}/${name}` });
        } catch {
          denied = true;
        }
        assert(denied, `${name} denied by physical path checks`);
      }
      await ev(
        `${P}const fs=require('node:fs');for(const path of s.links)fs.unlinkSync(path);s.links=[]`,
      );
    });
    await step('access: cancelling an in-flight grant never expands access', async () => {
      await ev(
        `${P}s.abort=new AbortController();s.abortedGrant=null;p.agentAccess.grantFolder(s.sibling,s.abort.signal).then(v=>s.abortedGrant=v)`,
      );
      await until(
        `return !!document.querySelector('.annotate-access-prompt')`,
        'cancellable grant opens',
      );
      await ev(`${P}s.abort.abort()`);
      await until(
        `${P}return s.abortedGrant===false&&!document.querySelector('.annotate-access-prompt')`,
        'abort closes grant',
      );
      assert(
        await ev(`${P}return !p.data.agent.folders.includes(s.sibling)`),
        'aborted folder remains denied',
      );
    });
    await step('access: grouped create edit and trash have recoverable snapshots', async () => {
      await ev(
        `${P}s.trashOriginal=app.fileManager.trashFile;s.trashed=[];app.fileManager.trashFile=async function(file,...args){s.trashed.push(file.path);return s.trashOriginal.call(this,file,...args)}`,
      );
      await call('edit_note', { path, expectedContent: original, content: edited });
      await call('create_note', { path: created, content: 'Synthetic created note' });
      await call('delete_note', { path: created, expectedContent: 'Synthetic created note' });
      assert(
        await ev(
          `${P}const record=s.notes.history.find(r=>r.id===s.folder+':group');return record?.status==='complete'&&record.changes.length===3&&s.trashed.includes(${JSON.stringify(created)})&&!app.vault.getAbstractFileByPath(${JSON.stringify(created)})`,
        ),
        'same turn grouped and deletion uses actual trash API',
      );
      await ev(`${P}await p.agentAccess.showHistory()`);
      await until(
        `return !!document.querySelector('.annotate-operation-history')`,
        'change history opens',
      );
      await button('.annotate-operation-history', 'View snapshots');
      assert(
        await ev(
          `return [...document.querySelectorAll('.annotate-access-preview')].some(e=>e.textContent.includes(${JSON.stringify(original)})&&e.textContent.includes(${JSON.stringify(edited)}))`,
        ),
        'history exposes before and after snapshots',
      );
      await ev(
        `document.querySelector('.modal-container:last-of-type .modal-close-button')?.click()`,
      );
      await shot('access-history');
      await button('.annotate-operation-history', 'Undo operation');
      await until(
        `${P}return s.notes.history.find(r=>r.id===s.folder+':group')?.status==='undone'`,
        'group undo completes',
      );
      assert(
        await ev(
          `return (await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)})))===${JSON.stringify(original)}&&!app.vault.getAbstractFileByPath(${JSON.stringify(created)})`,
        ),
        'entire grouped operation restored',
      );
      await closeHistory();
    });
    await step('access: history undo preserves a subsequently changed note', async () => {
      await call('edit_note', { path, expectedContent: original, content: edited }, 'conflict');
      await ev(
        `await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(path)}),'Synthetic later manual edit')`,
      );
      await ev(`${P}await p.agentAccess.showHistory()`);
      await button('.annotate-operation-history', 'Undo operation');
      await until(
        `return [...document.querySelectorAll('.notice')].some(e=>e.textContent.includes('Cannot undo'))`,
        'conflicting undo rejected',
      );
      assert(
        await ev(
          `${P}return (await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)})))==='Synthetic later manual edit'&&s.notes.history.find(r=>r.id===s.folder+':conflict').status==='complete'`,
        ),
        'manual change and recovery snapshot retained',
      );
      await closeHistory();
    });
    await step('access: external approval shows full arguments and can be cancelled', async () => {
      await ev(
        `${P}s.external=null;p.agentAccess.approveExternal({serviceName:'Synthetic service',url:'https://service.example/mcp',toolName:'send_message',arguments:{recipient:'synthetic',text:'Synthetic outbound private payload'},signal:new AbortController().signal}).then(v=>s.external=v)`,
      );
      await until(
        `return !!document.querySelector('.annotate-access-prompt')`,
        'external approval opens',
      );
      assert(
        await ev(
          `const modal=document.querySelector('.annotate-access-prompt');return modal.textContent.includes('https://service.example/mcp')&&modal.textContent.includes('send_message')&&modal.textContent.includes('Synthetic outbound private payload')&&modal.textContent.includes('this call only')`,
        ),
        'destination tool full arguments and one-call scope visible',
      );
      await shot('access-external-approval');
      await button('.annotate-access-prompt', 'Cancel');
      await until(`${P}return s.external===false`, 'external call denied');
      await ev(
        `${P}s.abort=new AbortController();s.external=null;p.agentAccess.approveExternal({serviceName:'Synthetic service',url:'https://service.example/mcp',toolName:'send_message',arguments:{text:'Synthetic'},signal:s.abort.signal}).then(v=>s.external=v)`,
      );
      await until(
        `return !!document.querySelector('.annotate-access-prompt')`,
        'second external prompt opens',
      );
      await ev(`${P}s.abort.abort()`);
      await until(
        `${P}return s.external===false&&!document.querySelector('.annotate-access-prompt')`,
        'abort denies and closes external prompt',
      );
    });
  } finally {
    await ev(
      `${P}if(s){p.agentAccess.cancelApprovals();for(const close of document.querySelectorAll('.annotate-operation-history .modal-close-button'))close.click();if(s.trashOriginal)app.fileManager.trashFile=s.trashOriginal;for(const path of s.links??[])if(require('node:fs').existsSync(path))require('node:fs').unlinkSync(path);s.mount?.remove();await s.notes.options.saveHistory(s.previousHistory);s.notes.records=structuredClone(s.previousHistory);for(const folder of [s.folder,s.sibling]){const file=app.vault.getAbstractFileByPath(folder);if(file)await app.vault.delete(file,true)}p.data.agent=s.previousAgent;p.data.codex.enabled=false;p.configureCodex();await p.persistOrThrow();delete window.__annotateAccessCheck}`,
    );
  }
}

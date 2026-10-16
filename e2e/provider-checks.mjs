import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export async function checkProviders({
  only,
  modes,
  themes,
  root,
  plugin,
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
}) {
  const P = `const p=app.plugins.plugins['annotate'];`;
  const sendQuestion = async (provider, question) => {
    const previous = await ev(`${P}return p.data.threads.at(-1)?.codex?.turnMessageId??null`);
    await ev(`document.querySelector('.annotate-composer textarea').focus()`);
    await type(`@${provider} ${question}`);
    await press('Enter');
    await until(
      `${P}const t=p.data.threads.at(-1);return p.submissions.has(t?.id)||(!!t?.codex?.turnMessageId&&t.codex.turnMessageId!==${JSON.stringify(previous)})`,
      'new assistant request starts',
    );
  };
  if (only.includes('providers')) {
    await ev(
      `${P}p.data.agent.folders=['Fixtures'];p.data.agent.consentVersion=1;await p.persist()`,
    );
    const dir = join(root, 'provider-fixtures');
    mkdirSync(dir, { recursive: true });
    const backend = join(dir, 'backend.cjs');
    await build({
      entryPoints: [join(plugin, 'src/claude.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: backend,
    });
    const codexBackend = join(dir, 'codex.cjs');
    await build({
      entryPoints: [join(plugin, 'src/codex.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: codexBackend,
    });
    const codexFixture = join(dir, 'codex-fixture');
    writeFileSync(
      codexFixture,
      readFileSync(join(plugin, 'tests/codex-fixture.cjs'), 'utf8').replace(
        /^#![^\n]*/,
        `#!${process.execPath}`,
      ),
      { mode: 0o700 },
    );
    const codexAuth = join(dir, 'codex-auth.json');
    writeFileSync(codexAuth, '{}', { mode: 0o600 });
    mkdirSync(join(dir, 'codex-home'), { recursive: true });
    writeFileSync(
      join(dir, 'codex-home', 'fixture-models.json'),
      JSON.stringify({ model: 'unavailable-cli-model', rejectUnavailable: true }),
    );
    const fixture = join(dir, 'assistant');
    writeFileSync(
      fixture,
      readFileSync(join(plugin, 'tests/assistant-fixture.cjs'), 'utf8').replace(
        /^#![^\n]*/,
        `#!${process.execPath}`,
      ),
      { mode: 0o700 },
    );
    await step(
      'providers: minimal settings selector changes assistant and mention token',
      async () => {
        await ev(
          `const tab=app.setting.pluginTabs.find(t=>t.id==='annotate'&&t.plugin===app.plugins.plugins.annotate);tab.__previousContainer=tab.containerEl;tab.containerEl=document.body.appendChild(Object.assign(document.createElement('div'),{className:'annotate-provider-settings-check'}));tab.display()`,
        );
        await until(
          `return !!document.querySelector('.annotate-provider-settings-check select')`,
          'assistant settings',
        );
        await ev(
          `const select=document.querySelector('.annotate-provider-settings-check select');select.value='claude';select.dispatchEvent(new Event('change'))`,
        );
        assert(
          await ev(
            `${P}return p.data.assistant.provider==='claude'&&document.querySelector('.annotate-provider-settings-check').textContent.includes('@claude')`,
          ),
          'settings select Claude',
        );
        await ev(
          `const tab=app.setting.pluginTabs.find(t=>t.id==='annotate'&&t.plugin===app.plugins.plugins.annotate);tab.containerEl.remove();tab.containerEl=tab.__previousContainer;delete tab.__previousContainer`,
        );
      },
    );
    await ev(
      `${P}delete require.cache[require.resolve(${JSON.stringify(backend)})];p.createBackend=function(id=this.data.assistant.provider){if(id==='chatgpt'){const {CodexBackend}=require(${JSON.stringify(codexBackend)});return new CodexBackend(${JSON.stringify(codexFixture)},()=>this.paintCodex(),{home:${JSON.stringify(join(dir, 'codex-home'))},authSource:${JSON.stringify(codexAuth)}})}const {ClaudeBackend}=require(${JSON.stringify(backend)});return new ClaudeBackend(${JSON.stringify(fixture)},'synthetic-model',()=>this.paintCodex())}`,
    );
    await step('providers: both connection checks work without switching the default', async () => {
      await ev(
        `${P}p.data.codex.enabled=false;p.data.assistant.provider='chatgpt';p.configureCodex();const tab=app.setting.pluginTabs.find(t=>t.id==='annotate'&&t.plugin===p);tab.__previousContainer=tab.containerEl;tab.containerEl=document.body.appendChild(Object.assign(document.createElement('div'),{className:'annotate-provider-settings-check'}));tab.display();const row=[...tab.containerEl.querySelectorAll('.setting-item')].find(r=>r.matches('.annotate-settings-provider')&&r.querySelector('.setting-item-name').textContent==='Claude');row.querySelector('button').click()`,
      );
      await until(
        `return [...document.querySelectorAll('.annotate-provider-settings-check button')].some(b=>b.textContent==='Connected')`,
        'connection check completed',
      );
      assert(
        await ev(`${P}return !p.data.codex.enabled&&p.backend===null`),
        'checking does not enable assistant',
      );
      assert(
        await ev(
          `${P}return p.data.assistant.provider==='chatgpt'&&p.connectionLabels.get('claude').textContent.startsWith('Ready')&&p.connectionLabels.has('chatgpt')`,
        ),
        'Claude has its own ready status with ChatGPT selected',
      );
      await ev(
        `const row=[...document.querySelectorAll('.annotate-provider-settings-check .setting-item')].find(r=>r.matches('.annotate-settings-provider')&&r.querySelector('.setting-item-name').textContent==='ChatGPT');row.querySelector('button').click()`,
      );
      await until(
        `${P}return p.connectionLabels.get('chatgpt').textContent.startsWith('Ready')`,
        'ChatGPT connection check completed',
      );
      assert(
        await ev(
          `${P}return !p.data.codex.enabled&&p.data.assistant.provider==='chatgpt'&&p.backend===null`,
        ),
        'both checks preserve assistant settings',
      );
      await ev(
        `const tab=app.setting.pluginTabs.find(t=>t.id==='annotate'&&t.plugin===app.plugins.plugins.annotate);tab.containerEl.remove();tab.containerEl=tab.__previousContainer;delete tab.__previousContainer;const settings=app.setting,previous=settings.shouldUsePopout;try{settings.shouldUsePopout=()=>false;settings.open();settings.openTabById('appearance');settings.openTabById('annotate')}finally{settings.shouldUsePopout=previous}`,
      );
      await until(
        `return [...document.querySelectorAll('.vertical-tab-content .setting-item')].some(r=>r.matches('.annotate-settings-provider')&&r.querySelector('.setting-item-name').textContent==='Claude')`,
        'both connection rows rendered',
      );
      await ev(
        `const row=[...document.querySelectorAll('.vertical-tab-content .setting-item')].find(r=>r.matches('.annotate-settings-provider')&&r.querySelector('.setting-item-name').textContent==='Claude');row.scrollIntoView({block:'end'})`,
      );
      await until(
        `return ['chatgpt','claude'].every(id=>document.querySelector('.vertical-tab-content .annotate-settings-codex-status[data-provider="'+id+'"]').textContent.startsWith('Ready'))`,
        'both ready statuses visible in settings',
      );
      await shot('connections-both-ready');
      await ev(`app.setting.close()`);
    });
    await step(
      'providers: unavailable inherited CLI model falls back and answers in Obsidian',
      async () => {
        await resetThreads();
        await ev(
          `${P}p.data.assistant.provider='chatgpt';p.data.codex.enabled=true;p.configureCodex()`,
        );
        await until(`${P}return p.backend?.state==='ready'`, 'ChatGPT fallback ready');
        assert(
          await ev(`${P}return p.backend.model==='fixture-model'`),
          'account default selected',
        );
        await openComposer('live');
        await sendQuestion('chatgpt', 'Explain the selected passage.');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
          'fallback model answered',
        );
        assert(
          await ev(
            `${P}return p.data.threads.at(-1).comments.at(-1).body==='Hello world'&&!!document.querySelector('.annotate-message-ai')`,
          ),
          'response rendered in the annotation thread',
        );
        assert(
          JSON.parse(readFileSync(join(dir, 'codex-home', 'fixture-models.json'), 'utf8')).model ===
            'unavailable-cli-model',
          'inherited CLI configuration unchanged',
        );
      },
    );
    await step(
      'providers: @claude routes from ChatGPT default and @chatgpt routes the reply',
      async () => {
        await resetThreads();
        await ev(
          `${P}p.data.assistant.provider='chatgpt';p.data.codex.enabled=true;p.configureCodex()`,
        );
        await openComposer('live');
        await type('@cl');
        assert(
          await ev(
            `return [...document.querySelectorAll('.annotate-mention-option')].filter(b=>!b.hidden).map(b=>b.textContent).join('').includes('@claude')`,
          ),
          'Claude available from ChatGPT default',
        );
        await press('Enter');
        await type('explain');
        await press('Enter');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
          'Claude mention routed',
        );
        assert(
          await ev(`${P}return p.data.threads.at(-1).comments.at(-1).provider==='claude'`),
          'Claude answered',
        );
        await sendQuestion('chatgpt', 'follow up');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='completed'&&p.data.threads.at(-1).comments.at(-1).provider==='chatgpt'`,
          'ChatGPT reply routed',
        );
      },
    );
    for (const provider of ['chatgpt', 'claude']) {
      for (const mode of modes) {
        await step(
          `providers [${provider}/${mode}]: plain questions and local @comment`,
          async () => {
            await resetThreads();
            await ev(
              `${P}p.data.assistant.provider=${JSON.stringify(provider)};p.data.codex.enabled=true;p.configureCodex()`,
            );
            await openComposer(mode);
            assert(
              await ev(
                `return document.querySelector('.annotate-composer textarea').placeholder.includes('@${provider}')`,
              ),
              'default assistant hint',
            );
            await type('explain this passage');
            await press('Enter');
            await until(
              `${P}return p.data.threads.at(-1)?.comments.length===2&&p.data.threads.at(-1)?.codex?.status==='completed'`,
              'implicit assistant answered',
            );
            assert(
              await ev(
                `${P}return p.data.threads.at(-1).comments.at(-1).provider===${JSON.stringify(provider)}`,
              ),
              'default provider answered',
            );
            await type('@co');
            await press('Enter');
            assert(
              await ev(
                `return document.querySelector('.annotate-composer textarea').value==='@comment '`,
              ),
              'comment completion',
            );
            await type('literal @claude @chatgpt');
            await press('Enter');
            await until(
              `${P}return p.data.threads.at(-1)?.comments.length===3`,
              'local comment saved',
            );
            assert(
              await ev(
                `${P}const c=p.data.threads.at(-1).comments.at(-1);return c.body==='literal @claude @chatgpt'&&c.role==='user'&&!c.provider`,
              ),
              'directive stripped and local intent saved',
            );
            await type('follow up');
            await press('Enter');
            await until(
              `${P}return p.data.threads.at(-1)?.comments.length===5&&p.data.threads.at(-1)?.codex?.status==='completed'`,
              'implicit reply answered',
            );
            if (provider === 'claude')
              assert(
                await ev(
                  `${P}return p.data.threads.at(-1).comments.at(-1).body.includes('literal @claude @chatgpt')`,
                ),
                'literal local mentions preserved in history',
              );
          },
        );
      }
    }
    for (const provider of ['claude']) {
      await step(`providers [${provider}]: subscription adapter connects`, async () => {
        await ev(
          `${P}p.data.assistant.provider=${JSON.stringify(provider)};p.data.codex.enabled=true;p.configureCodex()`,
        );
        await until(`${P}return p.backend.state==='ready'`, 'adapter ready');
      });
      for (const mode of modes)
        for (const theme of themes) {
          await step(
            `providers [${provider}/${mode}/${theme}]: mention, full note, reply and identity`,
            async () => {
              await resetThreads();
              await ev(
                `app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
              );
              await openComposer(mode);
              await type('@');
              assert(
                await ev(
                  `return document.querySelector('.annotate-mention-option strong')?.textContent===${JSON.stringify('Claude')}`,
                ),
                'selected provider mention',
              );
              await press('Enter');
              assert(
                await ev(
                  `return document.querySelector('.annotate-composer textarea').value===${JSON.stringify('@' + provider + ' ')}`,
                ),
                'mention completion does not submit',
              );
              await type('explain');
              await press('Enter');
              await until(
                `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
                'fixture response',
              );
              const result = await ev(
                `${P}const t=p.data.threads.at(-1),m=t.comments.at(-1);return {provider:m.provider,payload:JSON.parse(m.body),note:app.workspace.activeLeaf.view.file.path,author:document.querySelector('.annotate-message-ai strong')?.textContent}`,
              );
              assert(
                result.provider === provider && result.author.toLowerCase() === provider,
                'assistant identity',
              );
              assert(
                result.payload.noteText.includes('Boundary target: violet flower.') &&
                  result.payload.question === 'explain',
                'whole synthetic note and question',
              );
              await sendQuestion(provider, 'followup');
              await until(
                `${P}return p.data.threads.at(-1)?.comments.length===4&&p.data.threads.at(-1).codex.status==='completed'`,
                'followup',
              );
              assert(
                await ev(
                  `${P}return JSON.parse(p.data.threads.at(-1).comments.at(-1).body).conversationHistory.length===2`,
                ),
                'saved annotation history on followup',
              );
            },
          );
        }
      await step(
        `providers [${provider}]: cancellation, unknown outcome and explicit recovery`,
        async () => {
          await resetThreads();
          await createComment('live', '@comment synthetic recovery context');
          await sendQuestion(provider, 'cancel');
          await until(
            `${P}return p.data.threads.at(-1)?.codex?.status==='streaming'`,
            'streaming before cancel',
          );
          await ev(`document.querySelector('.annotate-codex-cancel').click()`);
          await until(`${P}return p.data.threads.at(-1)?.codex?.status==='cancelled'`, 'cancelled');
          await sendQuestion(provider, 'crash');
          await until(
            `${P}return p.data.threads.at(-1)?.codex?.status==='unknown'`,
            'crash unknown',
          );
          const count = await ev(`${P}return p.data.threads.at(-1).comments.length`);
          await ev(`document.querySelector('.annotate-codex-reset').click()`);
          await sendQuestion(provider, 'recover');
          await until(
            `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
            'explicit recovery',
          );
          assert(
            await ev(`${P}return p.data.threads.at(-1).comments.length===${count + 2}`),
            'no automatic resend',
          );
        },
      );
    }
    await step(
      'providers [chatgpt]: existing Codex stream, session continuation and cancel',
      async () => {
        await ev(
          `${P}delete require.cache[require.resolve(${JSON.stringify(codexBackend)})];p.data.assistant.provider='chatgpt';p.data.codex.enabled=true;p.configureCodex()`,
        );
        await until(`${P}return p.backend.state==='ready'`, 'Codex fixture ready');
        await sendQuestion('chatgpt', 'regression');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
          'Codex completed',
        );
        const session = await ev(
          `${P}const t=p.data.threads.at(-1);if(t.comments.at(-1).body!=='Hello world'||t.comments.at(-1).provider!=='chatgpt')throw Error('Codex identity/answer');return t.codex.sessionId`,
        );
        await sendQuestion('chatgpt', 'continue');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
          'Codex continuation',
        );
        assert(
          await ev(`${P}return p.data.threads.at(-1).codex.sessionId===${JSON.stringify(session)}`),
          'persistent Codex session',
        );
        await sendQuestion('chatgpt', 'cancel');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='streaming'`,
          'Codex streaming',
        );
        await ev(`document.querySelector('.annotate-codex-cancel').click()`);
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='cancelled'`,
          'Codex cancelled',
        );
      },
    );
    await step(
      'providers [chatgpt]: native commands are denied and native skills are unavailable',
      async () => {
        await sendQuestion('chatgpt', 'approval');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='failed'`,
          'native command rejected',
        );
        assert(
          await ev(`${P}return p.data.threads.at(-1).comments.at(-1).body==='rejected'`),
          'no automatic command approval',
        );
        assert(
          await ev(`${P}return (await p.backend.listSkills()).length===0`),
          'native skill discovery disabled',
        );
        // A native command refusal is a failed answer, so recover explicitly for remaining routing checks.
        await sendQuestion('chatgpt', 'continue');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
          'context-only continuation',
        );
      },
    );
    await step(
      'providers: switching assistants keeps history and replaces session identity',
      async () => {
        const old = await ev(`${P}return p.data.threads.at(-1).codex.sessionId`);
        await ev(`${P}p.data.assistant.provider='claude';p.configureCodex()`);
        await until(`${P}return p.backend.state==='ready'`, 'Claude ready');
        await sendQuestion('claude', 'after switch');
        await until(
          `${P}return p.data.threads.at(-1)?.codex?.status==='completed'`,
          'switched response',
        );
        assert(
          await ev(
            `${P}const t=p.data.threads.at(-1);return t.codex.provider==='claude'&&t.codex.sessionId!==${JSON.stringify(old)}&&t.comments.some(c=>c.provider==='chatgpt')&&JSON.parse(t.comments.at(-1).body).conversationHistory.length>0`,
          ),
          'sessions never cross providers',
        );
      },
    );
    await step(
      'providers: saved interrupted response becomes unknown on reload without resend',
      async () => {
        await ev(
          `${P}const t=p.data.threads.at(-1);t.codex.status='streaming';t.comments.at(-1).status='streaming';t.codex.turnMessageId=t.comments.at(-1).id;await p.persist()`,
        );
        const count = await ev(`${P}return p.data.threads.at(-1).comments.length`);
        await ev(
          `await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
        );
        assert(
          await ev(
            `${P}const t=p.data.threads.at(-1);return t.codex.status==='unknown'&&t.comments.at(-1).status==='unknown'&&t.comments.length===${count}`,
          ),
          'interrupted output retained without resend',
        );
        await ev(`${P}p.data.codex.enabled=false;p.configureCodex()`);
      },
    );
    await step('providers: saved identities and settings survive disable/re-enable', async () => {
      const before = await ev(
        `${P}p.data.codex.enabled=false;p.configureCodex();await p.persist();return JSON.stringify({threads:p.data.threads,assistant:p.data.assistant})`,
      );
      await ev(
        `await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
      );
      const after = await ev(
        `${P}return JSON.stringify({threads:p.data.threads,assistant:p.data.assistant})`,
      );
      assert(
        isDeepStrictEqual(JSON.parse(before), JSON.parse(after)),
        'provider settings and message identities persisted',
      );
      await ev(`${P}p.data.codex.enabled=false;p.configureCodex();await p.persist()`);
    });
  }
  for (const provider of ['chatgpt', 'claude']) {
    const scope = provider === 'chatgpt' ? 'codex-live' : 'claude-live';
    if (!only.includes(scope)) continue;
    if (process.env.ANNOTATE_LIVE_ACCOUNT !== '1')
      throw Error('Authenticated checks require explicit ANNOTATE_LIVE_ACCOUNT=1 authorization.');
    if (modes.length !== 1 || modes[0] !== 'live' || themes.length !== 1)
      throw Error('Authenticated checks require --modes live and one explicit --themes value.');
    const executable =
      process.env[
        provider === 'chatgpt' ? 'ANNOTATE_CODEX_EXECUTABLE' : 'ANNOTATE_CLAUDE_EXECUTABLE'
      ] ||
      execFileSync('which', [provider === 'chatgpt' ? 'codex' : 'claude'])
        .toString()
        .trim();
    if (provider === 'chatgpt' && !process.env.ANNOTATE_CODEX_AUTH_FILE)
      throw Error('codex-live requires an explicitly authorized ANNOTATE_CODEX_AUTH_FILE path.');
    await step(`${scope}: existing authorized CLI login`, async () => {
      await ev(
        `app.changeTheme(${JSON.stringify(themes[0] === 'light' ? 'moonstone' : 'obsidian')})`,
      );
      await ev(`${P}
        p.data.codex.enabled=false;p.configureCodex();
        p.data.agent.folders=['Fixtures'];p.data.agent.consentVersion=1;
        p.data.assistant.provider=${JSON.stringify(provider)};
        if(p.data.assistant.provider==='chatgpt') {
          p.data.codex.executable=${JSON.stringify(executable)};
          const original=p.createBackend.bind(p);
          p.createBackend=function(id=this.data.assistant.provider) {
            const backend=original(id);
            if(id==='chatgpt') backend.runtime={authSource:${JSON.stringify(process.env.ANNOTATE_CODEX_AUTH_FILE)}};
            return backend;
          };
        } else p.data.assistant.claude.executable=${JSON.stringify(executable)};
        p.data.codex.enabled=true;p.configureCodex();
      `);
      await until(`${P}return p.backend.state==='ready'`, 'authenticated CLI ready', 30_000);
    });
    await step(`${scope}: synthetic note answer in real Obsidian`, async () => {
      await resetThreads();
      await openComposer('live');
      await sendQuestion(
        provider,
        'Reply with exactly the two words naming the flower in the selected passage.',
      );
      await until(
        `${P}return ['completed','failed','unknown'].includes(p.data.threads.at(-1)?.codex?.status)`,
        'live answer',
        60_000,
      );
      const result = await ev(
        `${P}const t=p.data.threads.at(-1);return {status:t.codex.status,body:t.comments.at(-1).body,error:t.codex.error}`,
      );
      assert(
        result.status === 'completed' && /violet flower/i.test(result.body),
        JSON.stringify(result),
      );
      await shot(`${scope}-answer`);
    });
    await step(`${scope}: stop a real streamed response`, async () => {
      await sendQuestion(
        provider,
        'Write 100 numbered paragraphs about a synthetic violet flower.',
      );
      await until(
        `${P}const t=p.data.threads.at(-1);return t?.codex?.status==='streaming'&&!!t.comments.at(-1).body`,
        'live streamed text before cancellation',
        60_000,
      );
      await ev(`document.querySelector('.annotate-codex-cancel').click()`);
      await until(
        `${P}return p.data.threads.at(-1)?.codex?.status==='cancelled'`,
        'live cancelled',
      );
      await ev(`${P}await p.persist()`);
    });
    await step(`${scope}: reload retains cancellation and permits explicit recovery`, async () => {
      const count = await ev(`${P}return p.data.threads.at(-1).comments.length`);
      await ev(
        `await app.plugins.disablePlugin('annotate');await app.plugins.enablePlugin('annotate')`,
      );
      assert(
        await ev(
          `${P}const t=p.data.threads.at(-1);return t.codex.status==='cancelled'&&t.comments.length===${count}`,
        ),
        'cancelled response retained without automatic resend',
      );
      await until(`${P}return p.backend.state==='ready'`, 'reconnected CLI', 30_000);
      await ev(`${P}p.openThread(p.data.threads.at(-1))`);
      await sendQuestion(provider, 'Stop the earlier task. Reply with exactly RECOVERED.');
      await until(
        `${P}return ['completed','failed','unknown'].includes(p.data.threads.at(-1)?.codex?.status)`,
        'explicit recovery answer',
        60_000,
      );
      assert(
        await ev(
          `${P}const t=p.data.threads.at(-1);return t.codex.status==='completed'&&t.comments.at(-1).body.includes('RECOVERED')`,
        ),
        'explicit request succeeds after cancellation and reload',
      );
    });
    await ev(`${P}p.data.codex.enabled=false;p.configureCodex();await p.persist()`);
  }
  if (only.some((scope) => ['providers', 'claude-live', 'codex-live'].includes(scope)))
    await ev(
      `${P}p.data.codex.enabled=false;p.data.assistant.provider='chatgpt';p.configureCodex();await p.persist()`,
    );
}

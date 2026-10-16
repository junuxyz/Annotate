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
    writeFileSync(join(dir, 'codex-home', 'fixture-models.json'), JSON.stringify({}));
    const fixture = join(dir, 'assistant');
    writeFileSync(
      fixture,
      readFileSync(join(plugin, 'tests/assistant-fixture.cjs'), 'utf8').replace(
        /^#![^\n]*/,
        `#!${process.execPath}`,
      ),
      { mode: 0o700 },
    );
    await ev(
      `${P}delete require.cache[require.resolve(${JSON.stringify(backend)})];p.createBackend=function(id=this.data.assistant.provider){if(id==='chatgpt'){const {CodexBackend}=require(${JSON.stringify(codexBackend)});return new CodexBackend(${JSON.stringify(codexFixture)},()=>this.paintCodex(),{home:${JSON.stringify(join(dir, 'codex-home'))},authSource:${JSON.stringify(codexAuth)}})}const {ClaudeBackend}=require(${JSON.stringify(backend)});return new ClaudeBackend(${JSON.stringify(fixture)},'synthetic-model',()=>this.paintCodex())}`,
    );
    for (const provider of ['chatgpt', 'claude'])
      for (const mode of modes)
        for (const theme of themes)
          await step(
            `providers [${provider}/${mode}/${theme}]: one question renders an answer`,
            async () => {
              try {
                await resetThreads();
                await ev(
                  `${P}p.data.codex.enabled=false;p.configureCodex();p.data.assistant.provider=${JSON.stringify(provider)};p.data.codex.enabled=true;p.configureCodex();app.changeTheme(${JSON.stringify(theme === 'dark' ? 'obsidian' : 'moonstone')})`,
                );
                await until(`${P}return p.backend?.state==='ready'`, 'fixture backend ready');
                await openComposer(mode);
                await ev(`document.querySelector('.annotate-composer textarea')?.focus()`);
                await until(
                  `const input=document.querySelector('.annotate-composer textarea');return !!input&&!input.disabled&&!input.readOnly&&document.activeElement===input`,
                  'composer enabled and focused',
                );
                assert(
                  await ev(
                    `return document.querySelector('.annotate-composer textarea').placeholder.includes('@${provider}')`,
                  ),
                  'default assistant hint',
                );
                await type('explain this passage');
                assert(
                  await ev(
                    `return document.querySelector('.annotate-composer textarea').value==='explain this passage'`,
                  ),
                  'question reached the composer',
                );
                await press('Enter');
                await until(
                  `${P}return ['completed','failed','unknown'].includes(p.data.threads.at(-1)?.codex?.status)`,
                  'question reaches a terminal response state',
                );
                assert(
                  await ev(
                    `${P}const t=p.data.threads.at(-1),answer=t?.comments.at(-1);return t?.codex?.status==='completed'&&answer?.role==='assistant'&&answer.provider===${JSON.stringify(provider)}&&!!answer.body.trim()&&t.comments.some(c=>c.role==='user'&&c.body==='explain this passage')`,
                  ),
                  'the selected provider answered the submitted question',
                );
                await until(
                  `return !!document.querySelector('.annotate-message-ai .annotate-message-body')?.textContent.trim()`,
                  'answer appears in the thread',
                );
                await shot(`providers-${provider}-${mode}-${theme}-answer`);
              } catch (error) {
                let state;
                try {
                  state = await ev(
                    `${P}const input=document.querySelector('.annotate-composer textarea'),t=p.data.threads.at(-1);return {composer:input?{value:input.value,focused:document.activeElement===input,disabled:input.disabled,readOnly:input.readOnly}:null,backend:{state:p.backend?.state,detail:p.backend?.detail},thread:t?{id:t.id,provider:t.codex?.provider,status:t.codex?.status,error:t.codex?.error,comments:t.comments.map(c=>({role:c.role,provider:c.provider,body:c.body.slice(0,200)}))}:null}`,
                  );
                } catch {
                  state = { unavailable: true };
                }
                throw new Error(
                  `${error.message}; provider smoke state: ${JSON.stringify(state)}`,
                  { cause: error },
                );
              }
            },
          );
    await ev(`${P}p.data.codex.enabled=false;p.configureCodex();await p.persist()`);
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

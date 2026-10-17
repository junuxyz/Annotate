import { test } from 'node:test';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

test(
  'OpenCode 1.19.2 streams text and blocks advertised tools before execution',
  { skip: !process.env.ANNOTATE_OPENCODE_EXECUTABLE, timeout: 90_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'annotate-opencode-local-model-'));
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = join(root, 'synthetic-host-data');
    let calls = 0;
    let mode = 'text';
    let tools = [];
    let invocation;
    const sentinel = join(root, 'sentinel');
    const readable = join(root, 'synthetic.txt');
    writeFileSync(readable, 'PRIVATE_SYNTHETIC_SENTINEL');
    const model = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      calls++;
      assert.equal(req.url, '/v1/chat/completions');
      if (mode === 'error') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              type: 'FreeTierError',
              message: "OpenCode's free tier can only be used from within OpenCode.",
            },
          }),
        );
        return;
      }
      assert.equal(req.headers.authorization, 'Bearer synthetic-only');
      tools = request.tools.map((t) => t.function.name);
      assert.ok(tools.includes('bash') && tools.includes('read'));
      assert.ok(
        request.messages.some((m) => JSON.stringify(m.content).includes('Synthetic note only')),
      );
      res.setHeader('Content-Type', 'text/event-stream');
      const emit = (delta, finish_reason = null) =>
        res.write(
          `data: ${JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 0, model: 'model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      if (mode === 'tool') {
        if (request.messages.some((m) => m.role === 'tool')) {
          assert.ok(body.includes('Annotate does not permit tool execution.'));
          assert.ok(!body.includes('PRIVATE_SYNTHETIC_SENTINEL'));
          emit({ role: 'assistant', content: 'Blocked' });
          emit({}, 'stop');
        } else {
          emit({
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'synthetic_tool',
                type: 'function',
                function: { name: invocation.name, arguments: JSON.stringify(invocation.args) },
              },
            ],
          });
          emit({}, 'tool_calls');
        }
        res.end('data: [DONE]\n\n');
        return;
      }
      emit({ role: 'assistant', content: '' });
      emit({ content: 'Synthetic ' });
      setTimeout(() => {
        emit({ content: '한글 answer' });
        emit({}, 'stop');
        res.end('data: [DONE]\n\n');
      }, 100);
    });
    await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${model.address().port}/v1`;
    const wrapper = join(root, 'opencode');
    writeFileSync(
      wrapper,
      `#!${process.execPath}\nconst {spawn}=require('node:child_process');if(process.argv[2]==='models')process.exit(0);\nconst cfg=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);cfg.provider={synthetic:{npm:'@ai-sdk/openai-compatible',name:'Synthetic',options:{baseURL:${JSON.stringify(baseURL)},apiKey:'synthetic-only'},models:{model:{name:'Synthetic model'}}}};\nprocess.env.OPENCODE_CONFIG_CONTENT=JSON.stringify(cfg);process.env.OPENCODE_DISABLE_MODELS_FETCH='1';\nconst c=spawn(${JSON.stringify(process.env.ANNOTATE_OPENCODE_EXECUTABLE)},process.argv.slice(2),{env:process.env,stdio:'inherit'});\nprocess.on('SIGTERM',()=>c.kill());c.on('close',code=>process.exit(code??0));\n`,
      { mode: 0o700 },
    );
    await build({
      entryPoints: ['src/opencode.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: join(root, 'backend.cjs'),
    });
    const { OpenCodeBackend } = createRequire(import.meta.url)(join(root, 'backend.cjs'));
    const backend = new OpenCodeBackend(wrapper, 'synthetic/model', () => {});
    try {
      await backend.enable();

      let output = '';
      const id = await backend.session();
      const result = await new Promise((resolve, reject) => {
        void backend
          .ask(
            id,
            'Synthetic note only',
            (chunk) => (output += chunk),
            (state, error) => resolve({ state, error }),
          )
          .catch(reject);
      });
      assert.equal(result.state, 'completed', JSON.stringify(result));
      assert.equal(output, 'Synthetic 한글 answer');
      assert.equal(calls, 1);
      const args = {
        bash: { command: `printf synthetic > ${sentinel}`, description: 'Synthetic guard test' },
        read: { filePath: readable },
        write: { filePath: sentinel, content: 'synthetic' },
        edit: { filePath: readable, oldString: 'PRIVATE', newString: 'changed' },
        glob: { pattern: '*.txt', path: root },
        grep: { pattern: 'PRIVATE', path: root },
        webfetch: { url: baseURL, format: 'text' },
        task: { description: 'Synthetic', prompt: 'Synthetic note only', subagent_type: 'general' },
        todowrite: {
          todos: [{ id: 'synthetic', content: 'Synthetic', status: 'pending', priority: 'low' }],
        },
        skill: { name: 'synthetic' },
        question: {
          questions: [
            {
              question: 'Synthetic?',
              header: 'Test',
              options: [{ label: 'One', description: 'Synthetic' }],
            },
          ],
        },
      };
      mode = 'tool';
      for (const name of [...tools, 'redirect-only']) {
        invocation =
          name === 'redirect-only'
            ? {
                name: 'bash',
                args: { command: `> ${sentinel}`, description: 'Synthetic redirection' },
              }
            : { name, args: args[name] };
        assert.ok(invocation.args, `Add guard coverage for tool ${name}`);
        let answer = '';
        const blocked = await new Promise((resolve, reject) =>
          backend
            .ask(
              crypto.randomUUID(),
              'Synthetic note only',
              (s) => (answer += s),
              (state, error) => resolve({ state, error }),
            )
            .catch(reject),
        );
        assert.equal(blocked.state, 'completed', `${name}: ${JSON.stringify(blocked)}`);
        assert.equal(answer, 'Blocked', name);
        assert.equal(existsSync(sentinel), false, name);
        assert.equal(readFileSync(readable, 'utf8'), 'PRIVATE_SYNTHETIC_SENTINEL', name);
      }
      mode = 'error';
      const rejected = await new Promise((resolve, reject) => {
        void backend
          .ask(
            id,
            'Synthetic note only',
            () => {},
            (state, error) => resolve({ state, error }),
          )
          .catch(reject);
      });
      assert.equal(rejected.state, 'failed');
      assert.match(rejected.error, /FreeTierError/);
    } finally {
      backend.disable();
      model.closeAllConnections();
      model.close();
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      rmSync(root, { recursive: true, force: true });
    }
  },
);

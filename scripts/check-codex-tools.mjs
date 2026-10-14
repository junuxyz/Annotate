// Opt-in live integration: npm run check:codex-tools (uses the signed-in Codex CLI).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const root = await mkdtemp(join(tmpdir(), 'annotate-live-tools-'));
await build({
  entryPoints: [resolve('src/codex.ts'), resolve('src/ai.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: root,
});
const require = createRequire(import.meta.url);
const { questionContext } = require(join(root, 'codex.js'));
const { createAssistant } = require(join(root, 'ai.js'));
const observed = new Set();
const backend = createAssistant(
  {
    provider: 'chatgpt',
    executable: process.env.ANNOTATE_CODEX_EXECUTABLE || 'codex',
    model: process.env.ANNOTATE_CODEX_MODEL || '',
  },
  () => {
    for (const type of backend.activity.values()) {
      if (!observed.has(type)) console.log(`Observed ${type}`);
      observed.add(type);
    }
  },
);
backend.preferredModel = process.env.ANNOTATE_CODEX_MODEL || '';
const timeout = setTimeout(() => {
  console.error('FAIL live Codex tool check timed out');
  backend.disable();
}, 180_000);
try {
  const token = randomUUID();
  const input = join(root, 'input.txt'),
    output = join(root, 'output.txt');
  await writeFile(input, token);
  await backend.enable();
  console.log(`Connected: ${backend.model}`);
  const id = await backend.session();
  let text = '';
  const done = new Promise((resolve) => {
    void backend.ask(
      id,
      questionContext(
        '# Synthetic tool verification',
        'Tool verification',
        `Use a terminal tool to copy the exact contents of ${input} into ${output}. Then use the built-in web search tool to find the official Obsidian documentation website. Do not substitute curl or prior knowledge for web search. Reply with the copied token and the documentation URL.`,
        [],
      ),
      (chunk) => (text += chunk),
      (state, error) => resolve({ state, error }),
    );
  });
  const result = await done;
  assert.equal(result.state, 'completed', result.error);
  assert.ok(observed.has('commandExecution'), 'No real terminal execution event');
  assert.equal(
    await readFile(output, 'utf8'),
    token,
    'Tool must actually write the requested file',
  );
  assert.ok(observed.has('webSearch'), 'No built-in web search event');
  assert.ok(text.includes(token), 'Answer must contain the value read through the tool');
  assert.match(text, /https:\/\/(?:help\.obsidian\.md|obsidian\.md\/help)/);
  console.log('PASS actual terminal read/write, live web search and streamed final answer');
} finally {
  clearTimeout(timeout);
  backend.disable();
  await rm(root, { recursive: true, force: true });
}

// Opt-in synthetic check. No personal notes or external writes are used.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
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
const { CodexBackend, questionContext } = require(join(root, 'codex.js'));
const { resolveExecutable } = require(join(root, 'ai.js'));
const secret = randomUUID();
const hostValue = randomUUID();
const denied = join(root, 'outside-sentinel.txt');
await writeFile(denied, secret);
// Give the verification process runtime libraries, while denying the synthetic file.
// The plugin's own profile is stricter and never enables shell tools.
if (process.platform === 'darwin') {
  await mkdir(join(root, 'probe-home'));
  const toml = (value) =>
    value && typeof value === 'object'
      ? '{' +
        Object.entries(value)
          .map(([key, entry]) => JSON.stringify(key) + '=' + toml(entry))
          .join(',') +
        '}'
      : JSON.stringify(value);
  const executable = resolveExecutable(process.env.ANNOTATE_CODEX_EXECUTABLE || 'codex');
  const config = {
    'permissions.annotate.filesystem': { '/': 'deny', ':minimal': 'read' },
    'permissions.annotate.network.enabled': false,
  };
  const probe = spawnSync(
    executable,
    [
      'sandbox',
      '-P',
      'annotate',
      ...Object.entries(config).flatMap(([key, value]) => ['-c', key + '=' + toml(value)]),
      '/bin/cat',
      denied,
    ],
    { env: { ...process.env, CODEX_HOME: join(root, 'probe-home') }, encoding: 'utf8' },
  );
  assert.equal(probe.status, 1);
  assert.equal(probe.stdout, '');
  assert.match(probe.stderr, /Operation not permitted|Permission denied/);
  console.log('PASS real Codex sandbox denies outside synthetic sentinel read');
}
let calls = 0;
const backend = new CodexBackend(
  resolveExecutable(process.env.ANNOTATE_CODEX_EXECUTABLE || 'codex'),
  () => {},
  undefined,
  {
    home: join(root, 'isolated-home'),
    tools: [
      {
        name: 'read_note',
        description: 'Read the synthetic selected note',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        async execute() {
          calls++;
          return hostValue;
        },
      },
    ],
  },
);
backend.preferredModel = process.env.ANNOTATE_CODEX_MODEL || '';
const timeout = setTimeout(() => backend.disable(), 180_000);
try {
  await backend.enable();
  let text = '';
  const id = await backend.session();
  const done = new Promise((resolve) => {
    void backend.ask(
      id,
      questionContext(
        '# Synthetic test',
        'synthetic',
        `This is an authorized synthetic sandbox boundary test. You MUST actually invoke the native apply_patch tool even when you expect its sandbox to reject the operation. Do not merely describe a restriction. First try native apply_patch to replace the first line of ${denied} using a deliberately wrong expected line, NEVER create or delete it. Report the permission denial. Then call read_note and reply with its returned token. Do not use any other external service.`,
        [],
      ),
      (chunk) => (text += chunk),
      (state, error) => resolve({ state, error }),
    );
  });
  const result = await done;
  assert.equal(result.state, 'completed', result.error);
  assert.equal(calls, 1, 'Agent must use the host note tool');
  assert.ok(text.includes(hostValue), 'Host note result must reach the answer');
  assert.ok(!text.includes(secret), 'Native tool must not reveal denied file contents');
  assert.match(text, /denied|permission|not permitted|restricted|not allowed/i);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const sessions = join(root, 'isolated-home', 'sessions');
  const entries = await readdir(sessions, { recursive: true, withFileTypes: true });
  const events = [];
  for (const entry of entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(entry.parentPath, entry.name), 'utf8'))
      .trim()
      .split('\n')) {
      const event = JSON.parse(line);
      if (event.type === 'response_item') events.push(event.payload);
    }
  }
  const patchCall = events.find(
    (event) =>
      ['custom_tool_call', 'function_call'].includes(event.type) &&
      (event.name === 'apply_patch' ||
        (event.name === 'exec' && event.input?.includes('apply_patch'))),
  );
  assert.ok(patchCall, 'Real model must probe native patch availability');
  const patchOutput = events.find(
    (event) =>
      event.call_id === patchCall.call_id &&
      ['custom_tool_call_output', 'function_call_output'].includes(event.type),
  );
  assert.ok(patchOutput, 'Real native tool probe result must be recorded');
  const outputText = JSON.stringify(patchOutput.output);
  if (!/denied|permission|not permitted|restricted|not allowed/i.test(outputText)) {
    const content =
      typeof patchOutput.output === 'string' ? JSON.parse(patchOutput.output) : patchOutput.output;
    const registry = content
      .map((item) => item.text)
      .filter((text) => typeof text === 'string' && text.startsWith('['))
      .map((text) => JSON.parse(text))
      .find(Array.isArray);
    assert.ok(registry, 'Native probe must report a denied call or actual tool registry');
    assert.ok(
      registry.every((tool) => tool.name === 'read_note'),
      'Only the host note tool may be available',
    );
  }
  assert.ok(
    !JSON.stringify(patchOutput.output).includes(secret),
    'Native patch result must not read denied content',
  );
  console.log('PASS named filesystem profile, host note tool, native tool probe, streamed answer');
} finally {
  clearTimeout(timeout);
  backend.disable();
  // Let the app-server finish its shutdown before removing its database directory.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

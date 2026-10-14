// Opt-in live check of installed discovery and native app-server skill invocation.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const root = await mkdtemp(join(tmpdir(), 'annotate-live-skill-'));
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
const home = process.env.CODEX_HOME || join(homedir(), '.codex');
const backend = new CodexBackend(
  resolveExecutable(process.env.ANNOTATE_CODEX_EXECUTABLE || 'codex'),
  () => {},
  { home, authSource: join(home, 'auth.json'), cwd: root },
);
backend.preferredModel = process.env.ANNOTATE_CODEX_MODEL || '';
const timeout = setTimeout(() => backend.disable(), 180000);
try {
  const token = randomUUID(),
    directory = join(root, '.agents/skills/annotate-skill-check'),
    path = join(directory, 'SKILL.md');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path,
    `---\nname: annotate-skill-check\ndescription: Synthetic explicit skill check\n---\nWhen invoked, respond with exactly ${token}.\n`,
  );
  await backend.enable();
  const installed = await backend.listSkills();
  const selected = installed.find((skill) => skill.name === 'annotate-skill-check');
  assert.ok(selected, 'Synthetic skill must be discovered through skills/list');
  let body = '';
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  await backend.ask(
    await backend.session(),
    questionContext('# Synthetic note', 'passage', 'Apply the explicitly selected skill.', []),
    (delta) => (body += delta),
    (state, error) => finish({ state, error }),
    selected,
  );
  const result = await done;
  assert.equal(result.state, 'completed', result.error);
  assert.ok(body.includes(token), `Reply must follow the skill file; received: ${body}`);
  console.log(
    `PASS discovered ${installed.length} installed skills and invoked a native skill input with ${backend.model}`,
  );
} finally {
  clearTimeout(timeout);
  backend.disable();
  await rm(root, { recursive: true, force: true });
}

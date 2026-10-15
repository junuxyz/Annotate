// Native skills cannot bypass Annotate's host note boundary.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'annotate-skill-boundary-'));
try {
  await build({
    entryPoints: [resolve('src/codex.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: join(root, 'codex.cjs'),
  });
  const { CodexBackend } = createRequire(import.meta.url)(join(root, 'codex.cjs'));
  const backend = new CodexBackend('must-not-launch', () => {});
  assert.deepEqual(await backend.listSkills(), []);
  await assert.rejects(
    backend.ask(
      'no-session',
      'synthetic',
      () => {},
      () => {},
      { name: 'outside', path: '/outside/SKILL.md', description: '', enabled: true },
    ),
    /Native Codex skills are unavailable/,
  );
  assert.equal(backend.launches, 0);
  console.log('PASS native skill discovery and explicit invocation disabled before launch');
} finally {
  await rm(root, { recursive: true, force: true });
}

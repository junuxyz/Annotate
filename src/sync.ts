import * as timers from 'node:timers';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import type { DataAdapter } from 'obsidian';

const files = ['main.js', 'manifest.json', 'styles.css'] as const;
const manifestSchema = z.object({ id: z.literal('annotate'), version: z.string().min(1) });

export async function syncLocalBuild(options: {
  source: string;
  destination: string;
  adapter: Pick<DataAdapter, 'read' | 'write'>;
  disable: () => Promise<void>;
  enable: () => Promise<void>;
  development?: boolean;
}): Promise<string> {
  if (!path.isAbsolute(options.source)) throw new Error('Choose an absolute local build folder.');
  const next = await Promise.all(
    files.map((file) => fs.readFile(path.join(options.source, file), 'utf8')),
  );
  const manifest = manifestSchema.parse(JSON.parse(next[1] ?? ''));
  const buildId = options.development ? await developmentId(options.source) : null;
  if (buildId && buildId !== fingerprint(next))
    throw new Error('Development build is incomplete. Wait for the next successful build.');
  if (!next[0]?.trim()) throw new Error('The local build is empty. Run npm run build first.');
  const previous = await Promise.all(
    files.map((file) => options.adapter.read(`${options.destination}/${file}`)),
  );
  // Keep the attempted revision on rollback too, so a failed auto-update cannot loop.
  if (buildId)
    await options.adapter.write(
      `${options.destination}/development-state.json`,
      JSON.stringify({ lastAttempt: buildId }),
    );
  await options.disable();
  try {
    for (const [index, file] of files.entries())
      await options.adapter.write(`${options.destination}/${file}`, next[index] ?? '');
    await options.enable();
  } catch (error) {
    await options.disable();
    for (const [index, file] of files.entries())
      await options.adapter.write(`${options.destination}/${file}`, previous[index] ?? '');
    await options.enable();
    throw error;
  }
  return manifest.version;
}

const developmentSchema = z.object({
  format: z.literal(1),
  buildId: z.string().regex(/^[a-f0-9]{64}$/),
});
const attemptSchema = z.object({ lastAttempt: z.string().regex(/^[a-f0-9]{64}$/) });

function fingerprint(contents: string[]): string {
  return crypto.createHash('sha256').update(contents.join('\0')).digest('hex');
}
async function developmentId(source: string): Promise<string> {
  return developmentSchema.parse(
    JSON.parse(await fs.readFile(path.join(source, 'development.json'), 'utf8')),
  ).buildId;
}

export async function watchDevelopmentBuild(options: {
  source: string;
  destination: string;
  adapter: Pick<DataAdapter, 'read'>;
  ready: () => boolean;
  apply: () => Promise<boolean>;
  intervalMs?: number;
}): Promise<() => void> {
  let attempted: string;
  try {
    attempted = attemptSchema.parse(
      JSON.parse(await options.adapter.read(`${options.destination}/development-state.json`)),
    ).lastAttempt;
  } catch {
    attempted = fingerprint(
      await Promise.all(
        files.map((file) => options.adapter.read(`${options.destination}/${file}`)),
      ),
    );
  }
  let stopped = false,
    running = false;
  const check = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const id = await developmentId(options.source);
      if (stopped || id === attempted || !options.ready()) return;
      attempted = id;
      await options.apply();
    } catch {
      // A missing checkout or an unfinished build must leave the running plugin alone.
    } finally {
      running = false;
    }
  };
  const timer = timers.setInterval(() => void check(), options.intervalMs ?? 1000);
  void check();
  return () => {
    stopped = true;
    timers.clearInterval(timer);
  };
}

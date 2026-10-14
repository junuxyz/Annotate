import { z } from 'zod';
import type { DataAdapter } from 'obsidian';

declare const ANNOTATE_BUILD_DIRECTORY: string;
export const defaultBuildDirectory =
  typeof ANNOTATE_BUILD_DIRECTORY === 'string' ? ANNOTATE_BUILD_DIRECTORY : '';
const files = ['main.js', 'manifest.json', 'styles.css'] as const;
const manifestSchema = z.object({ id: z.literal('annotate'), version: z.string().min(1) });

export async function syncLocalBuild(options: {
  source: string;
  destination: string;
  adapter: Pick<DataAdapter, 'read' | 'write'>;
  disable: () => Promise<void>;
  enable: () => Promise<void>;
}): Promise<string> {
  const fs: typeof import('node:fs/promises') = require('node:fs/promises');
  const path: typeof import('node:path') = require('node:path');
  if (!path.isAbsolute(options.source)) throw new Error('Choose an absolute local build folder.');
  const next = await Promise.all(
    files.map((file) => fs.readFile(path.join(options.source, file), 'utf8')),
  );
  const manifest = manifestSchema.parse(JSON.parse(next[1] ?? ''));
  if (!next[0]?.trim()) throw new Error('The local build is empty. Run npm run build first.');
  const previous = await Promise.all(
    files.map((file) => options.adapter.read(`${options.destination}/${file}`)),
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

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const buildFiles = ['main.js', 'manifest.json', 'styles.css'];
export const fingerprint = (contents) =>
  createHash('sha256').update(contents.join('\0')).digest('hex');

export function publishDevelopmentBuild(directory, contents) {
  mkdirSync(directory, { recursive: true });
  for (const [index, name] of buildFiles.entries())
    writeFileSync(join(directory, name), contents[index]);
  const metadata = { format: 1, buildId: fingerprint(contents) };
  const temporary = join(directory, 'development.json.tmp');
  writeFileSync(temporary, JSON.stringify(metadata));
  renameSync(temporary, join(directory, 'development.json'));
  return metadata;
}

export function readDevelopmentBuild(directory) {
  const metadata = JSON.parse(readFileSync(join(directory, 'development.json'), 'utf8'));
  const contents = buildFiles.map((name) => readFileSync(join(directory, name), 'utf8'));
  if (metadata.format !== 1 || metadata.buildId !== fingerprint(contents))
    throw new Error('Development build is incomplete. Build again before installing.');
  const manifest = JSON.parse(contents[1]);
  if (manifest.id !== 'annotate') throw new Error('This is not an Annotate build.');
  return { contents, buildId: metadata.buildId, directory: resolve(directory) };
}

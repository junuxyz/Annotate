import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildFiles, readDevelopmentBuild } from './development-build.mjs';
const argument = process.argv[2];
if (!argument) throw new Error('Pass the development vault path.');
const vault = resolve(argument);
if (!existsSync(join(vault, '.obsidian'))) throw new Error('This folder is not an Obsidian vault.');
const build = readDevelopmentBuild(resolve('.development'));
const destination = join(vault, '.obsidian/plugins/annotate');
mkdirSync(destination, { recursive: true });
for (const name of buildFiles) copyFileSync(join(build.directory, name), join(destination, name));
writeFileSync(
  join(destination, 'development-state.json'),
  JSON.stringify({ lastAttempt: build.buildId }),
);
console.log(
  `Development build installed in ${destination}. Reload Annotate once to start automatic updates.`,
);

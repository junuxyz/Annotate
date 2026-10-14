import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const vaultIndex = args.indexOf('--vault');
const vault = vaultIndex < 0 ? null : resolve(args[vaultIndex + 1] ?? '');
const watch = args.includes('--watch');
const pluginDir = vault ? resolve(vault, '.obsidian/plugins/annotate') : null;
let activated = false;
if (vault && !existsSync(resolve(vault, '.obsidian')))
  throw new Error(`No .obsidian directory in vault: ${vault}`);

const options = {
  entryPoints: ['src/main.ts'],
  define: { ANNOTATE_BUILD_DIRECTORY: JSON.stringify(resolve('.')) },
  bundle: true,
  loader: { '.png': 'dataurl' },
  outfile: 'main.js',
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  sourcemap: false,
  minify: true,
  external: ['node:*', 'obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
  plugins: pluginDir
    ? [
        {
          name: 'deploy-to-vault',
          setup(build) {
            if (watch)
              build.onStart(() => {
                try {
                  execFileSync('./node_modules/.bin/tsc', ['--noEmit'], { stdio: 'inherit' });
                } catch {
                  return { errors: [{ text: 'TypeScript check failed; build not deployed.' }] };
                }
              });
            build.onEnd((result) => {
              if (result.errors.length) return;
              mkdirSync(pluginDir, { recursive: true });
              for (const file of ['main.js', 'manifest.json', 'styles.css'])
                copyFileSync(file, resolve(pluginDir, file));
              if (!activated) {
                const enabledPath = resolve(vault, '.obsidian/community-plugins.json');
                if (!existsSync(enabledPath))
                  throw new Error(`Missing Obsidian plugin list: ${enabledPath}`);
                const current = JSON.parse(readFileSync(enabledPath, 'utf8'));
                const enabled = [...new Set(current)];
                if (!enabled.includes('annotate')) enabled.push('annotate');
                if (JSON.stringify(current) !== JSON.stringify(enabled))
                  writeFileSync(enabledPath, JSON.stringify(enabled, null, 2) + '\n');
                activated = true;
                console.log('Enabled Annotate; reload Obsidian to apply.');
              }
              console.log(`Updated Annotate in ${pluginDir}`);
            });
          },
        },
      ]
    : [],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log(vault ? `Watching Annotate and deploying to ${pluginDir}` : 'Watching Annotate');
} else await esbuild.build(options);

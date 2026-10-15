import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { watch as watchFile } from 'node:fs';
import { publishDevelopmentBuild } from './scripts/development-build.mjs';

const args = process.argv.slice(2);
const vaultIndex = args.indexOf('--vault');
const vault = vaultIndex < 0 ? null : resolve(args[vaultIndex + 1] ?? '');
const watch = args.includes('--watch');
const development =
  watch || args.includes('--dev') || vault !== null || process.env.ANNOTATE_DEV_BUILD === '1';
const developmentDirectory = resolve('.development');
const pluginDir = vault ? resolve(vault, '.obsidian/plugins/annotate') : null;
let activated = false;
if (vault && !existsSync(resolve(vault, '.obsidian')))
  throw new Error(`No .obsidian directory in vault: ${vault}`);

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  loader: { '.png': 'dataurl' },
  outfile: 'main.js',
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  sourcemap: false,
  minify: true,
  define: {
    ANNOTATE_DEVELOPMENT: JSON.stringify(development),
    ANNOTATE_BUILD_DIRECTORY: JSON.stringify(development ? developmentDirectory : ''),
  },
  external: ['node:*', 'obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
  plugins: [
    {
      name: 'development-build',
      setup(build) {
        if (watch)
          build.onStart(() => {
            try {
              execFileSync('./node_modules/.bin/tsc', ['--noEmit'], { stdio: 'inherit' });
            } catch {
              return { errors: [{ text: 'TypeScript check failed; build not published.' }] };
            }
          });
        build.onEnd(async (result) => {
          if (result.errors.length) return;
          if (!development) {
            await esbuild.build({
              ...options,
              outfile: resolve(developmentDirectory, 'main.js'),
              define: {
                ANNOTATE_DEVELOPMENT: 'true',
                ANNOTATE_BUILD_DIRECTORY: JSON.stringify(developmentDirectory),
              },
              plugins: [],
            });
          }
          const code = readFileSync(
            development ? 'main.js' : resolve(developmentDirectory, 'main.js'),
            'utf8',
          );
          const contents = [
            code,
            readFileSync('manifest.json', 'utf8'),
            readFileSync('styles.css', 'utf8'),
          ];
          const published = publishDevelopmentBuild(developmentDirectory, contents);
          // Bootstrap once. The installed development plugin applies later builds itself.
          if (pluginDir && !activated) {
            mkdirSync(pluginDir, { recursive: true });
            for (const file of ['main.js', 'manifest.json', 'styles.css'])
              copyFileSync(resolve(developmentDirectory, file), resolve(pluginDir, file));
            writeFileSync(
              resolve(pluginDir, 'development-state.json'),
              JSON.stringify({ lastAttempt: published.buildId }),
            );
            const enabledPath = resolve(vault, '.obsidian/community-plugins.json');
            if (!existsSync(enabledPath))
              throw new Error(`Missing Obsidian plugin list: ${enabledPath}`);
            const current = JSON.parse(readFileSync(enabledPath, 'utf8'));
            const enabled = [...new Set([...current, 'annotate'])];
            if (JSON.stringify(current) !== JSON.stringify(enabled))
              writeFileSync(enabledPath, JSON.stringify(enabled, null, 2) + '\n');
            activated = true;
            console.log(
              `Installed development build in ${pluginDir}. Enable or reload Annotate once; later builds update automatically.`,
            );
          }
        });
      },
    },
  ],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  let extraBuild;
  for (const file of ['styles.css', 'manifest.json'])
    watchFile(file, () => {
      clearTimeout(extraBuild);
      extraBuild = setTimeout(
        () => void context.rebuild().catch((error) => console.error(error.message)),
        100,
      );
    });
  console.log(vault ? `Watching Annotate and deploying to ${pluginDir}` : 'Watching Annotate');
} else await esbuild.build(options);

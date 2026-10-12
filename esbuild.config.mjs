import esbuild from 'esbuild';
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  sourcemap: false,
  minify: true,
  external: ['node:*', 'obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
};
if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
} else await esbuild.build(options);

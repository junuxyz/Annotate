import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

if (!global.gc) throw new Error('Run with node --expose-gc scripts/benchmark-rendering.mjs');
const directory = await mkdtemp(join(tmpdir(), 'annotate-rendering-benchmark-'));
try {
  const output = join(directory, 'highlight.mjs');
  await build({
    entryPoints: ['src/highlight.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: output,
  });
  const api = await import(pathToFileURL(process.argv[2] ?? output).href);
  const plain = '합성 문서의 문장과 **강조** 및 `code`입니다.\n'.repeat(2000);
  const styled =
    '일반 **<mark data-annotate-highlight="yellow">강조</mark>** 뒤 <span data-annotate-color="red">색상</span>\n'.repeat(
      1000,
    );
  const scan = (source) =>
    api.noteStyles
      ? api.noteStyles(source)
      : { highlights: api.noteHighlights(source), colors: api.noteHighlights(source, 'span') };
  console.log(
    JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }),
  );
  for (const [name, source] of [
    ['plain scan', plain],
    ['styled scan', styled],
    [
      'complex scan',
      (styled.slice(0, 100) + '[link](https://example.com) `code` $x$\n').repeat(1000),
    ],
    ['styled syntax', styled],
    ['sparse syntax', `<mark data-annotate-highlight="yellow">selected</mark>\n${plain.repeat(8)}`],
  ]) {
    const styles = scan(source);
    const ranges = [...styles.highlights, ...styles.colors];
    const run = () =>
      name.endsWith('syntax') ? api.highlightSyntax(source, ranges) : scan(source);
    for (let index = 0; index < 3; index++) run();
    const samples = [];
    let heap = 0;
    for (let index = 0; index < 9; index++) {
      global.gc();
      const before = process.memoryUsage().heapUsed;
      const start = performance.now();
      const result = run();
      samples.push(performance.now() - start);
      heap += process.memoryUsage().heapUsed - before;
      if (!result) throw new Error('Missing benchmark result');
    }
    samples.sort((left, right) => left - right);
    console.log(
      JSON.stringify({
        name,
        chars: source.length,
        medianMs: +samples[4].toFixed(2),
        meanHeapMiB: +(heap / 9 / 1048576).toFixed(2),
      }),
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

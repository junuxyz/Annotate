import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
const output = new URL('./.math.mjs', import.meta.url);
await build({
  entryPoints: ['src/math.ts'],
  bundle: true,
  outfile: output.pathname,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: new URL('./host.mjs', import.meta.url).pathname },
  external: ['@codemirror/state'],
});
const { mathParts } = await import(output.href);
after(() => unlink(output));
const math = (text) => mathParts(text).filter((p) => p.kind === 'math');
test('LaTeX delimiters, code, escaped dollars, currency and incomplete streams', () => {
  assert.deepEqual(
    math(String.raw`a $x^2$ $$\frac{a}{b}$$ \(y\) \[z\]`).map((p) => [p.source, p.display]),
    [
      ['x^2', false],
      [String.raw`\frac{a}{b}`, true],
      ['y', false],
      ['z', true],
    ],
  );
  for (const text of [
    String.raw`\$x\$`,
    '`$x$`',
    '```latex\n$$x$$\n```',
    '~~~latex\n\\(x\\)\n~~~',
    '    \\(x\\)',
    '$5 and $10',
    '$x',
    '$ x $',
    '$x\ny$',
  ])
    assert.equal(math(text).length, 0, text);
  assert.equal(math('$x$ unfinished $y').length, 1);
  assert.equal(
    mathParts('<b>한글</b>\n$x$')
      .map((p) => p.text)
      .join(''),
    '<b>한글</b>\n$x$',
  );
});

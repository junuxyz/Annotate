import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { unlink } from 'node:fs/promises';

const output = new URL('./.markdown.mjs', import.meta.url);
await build({
  entryPoints: ['src/markdown.ts'],
  bundle: true,
  outfile: output.pathname,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: new URL('./host.mjs', import.meta.url).pathname },
  external: ['@codemirror/state'],
});
const { CommentMarkdown } = await import(output.href);
after(() => unlink(output));

test('native renderer gets source path and Markdown, latest stream wins, cleanup releases components', async () => {
  const window = new Window();
  const body = window.document.createElement('div');
  const renderer = new CommentMarkdown();
  const calls = [];
  const app = {
    renderMarkdown(text, el, path, component) {
      return new Promise((resolve, reject) =>
        calls.push({ text, el, path, component, resolve, reject }),
      );
    },
  };
  renderer.paint(app, body, '**old**', 'Fixtures/Annotations.md');
  renderer.paint(app, body, '@chatgpt **latest**', 'Fixtures/Annotations.md');
  assert.equal(calls[0].component.loaded, false);
  assert.equal(calls[1].path, 'Fixtures/Annotations.md');
  assert.equal(calls[1].text, '@chatgpt **latest**');
  calls[1].el.innerHTML = '<p>@chatgpt <strong>latest</strong> <code>@chatgpt</code></p>';
  calls[1].resolve();
  await new Promise((r) => setTimeout(r, 0));
  calls[0].el.textContent = 'old';
  calls[0].resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(body.querySelector('strong').textContent, 'latest');
  assert.equal(body.querySelector('.annotate-chatgpt-mention').textContent, '@chatgpt');
  assert.equal(body.querySelector('code .annotate-chatgpt-mention'), null);
  renderer.paint(app, body, '@chatgpt **latest**', 'Fixtures/Annotations.md');
  assert.equal(calls.length, 2, 'unchanged content does not restart rendering');
  renderer.paint(
    app,
    body,
    String.raw`\(x\) and \[y\] and ` + '`$literal$`',
    'Fixtures/Annotations.md',
  );
  assert.equal(calls[2].text, '$x$ and $$\ny\n$$ and `$literal$`');
  renderer.clear();
  assert.equal(calls[2].component.loaded, false);
  calls[2].el.textContent = 'closed';
  calls[2].resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    body.querySelector('strong').textContent,
    'latest',
    'closed renders never update the DOM',
  );
  renderer.paint(app, body, 'fallback <script>', 'Fixtures/Annotations.md');
  calls[3].reject(new Error('renderer unavailable'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(body.textContent, 'fallback <script>');
  assert.equal(body.querySelector('script'), null);
  assert.equal(calls[3].component.loaded, false);
  await window.happyDOM.close();
});

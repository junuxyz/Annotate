import { same } from './assertions.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { unlink } from 'node:fs/promises';
import { parser } from '@lezer/markdown';

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
const { CommentMarkdown, safeCommentMarkdown } = await import(output.href);
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
  same(body.querySelector('code .annotate-chatgpt-mention'), null);
  renderer.paint(app, body, '@chatgpt **latest**', 'Fixtures/Annotations.md');
  assert.equal(calls.length, 2, 'unchanged content does not restart rendering');
  renderer.paint(
    app,
    body,
    String.raw`\(x\) and \[y\] and ` + '`$literal$`',
    'Fixtures/Annotations.md',
  );
  assert.equal(calls[2].text, '$x$ and $$y$$ and `$literal$`');
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
  same(body.querySelector('script'), null);
  assert.equal(calls[3].component.loaded, false);
  await window.happyDOM.close();
});

test('display delimiter conversion adds no blank lines and preserves list indentation', async () => {
  const window = new Window();
  const body = window.document.createElement('div');
  const renderer = new CommentMarkdown();
  const calls = [];
  const app = {
    async renderMarkdown(text) {
      calls.push(text);
    },
  };
  const text =
    String.raw`- **Gate:**

  \[
  \alpha_{t,h} \in \mathbb{R}
  \]

  One decay value scales the whole memory matrix.

  \[
  S_{t,h}=\alpha_{t,h}S_{t-1,h}+\text{update}
  \]

\[
\begin{aligned}
x &= y \\
y &= z
\end{aligned}
\]

` + '```latex\n\\[literal\\]\n```';
  renderer.paint(app, body, text, 'Fixtures/Annotations.md');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    calls[0],
    String.raw`- **Gate:**

  $$\alpha_{t,h} \in \mathbb{R}$$

  One decay value scales the whole memory matrix.

  $$S_{t,h}=\alpha_{t,h}S_{t-1,h}+\text{update}$$

$$\begin{aligned}
x &= y \\
y &= z
\end{aligned}$$

` + '```\n\\[literal\\]\n```',
  );
  renderer.clear();
  await window.happyDOM.close();
});

test('skill commands and assistant mentions are highlighted without changing code or file paths', async () => {
  const window = new Window(),
    body = window.document.createElement('div'),
    renderer = new CommentMarkdown();
  const app = {
    async renderMarkdown(text, el) {
      el.innerHTML =
        '<p>@chatgpt /amplifier explain @claude @opencode <code>/amplifier @claude @opencode</code> /usr/local</p>';
    },
  };
  try {
    renderer.paint(app, body, '@chatgpt /amplifier explain @claude', 'test.md');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(body.querySelector('.annotate-skill-mention').textContent, '/amplifier');
    assert.equal(body.querySelector('.annotate-claude-mention').textContent, '@claude');
    assert.equal(body.querySelector('.annotate-opencode-mention').textContent, '@opencode');
    same(body.querySelector('code .annotate-opencode-mention'), null);
    same(body.querySelector('code .annotate-skill-mention'), null);
    assert.equal(body.querySelectorAll('.annotate-skill-mention').length, 1);
    renderer.paint(app, body, '/usr/local is a file path', 'test.md');
    await new Promise((resolve) => setTimeout(resolve, 0));
    same(body.querySelector('.annotate-skill-mention'), null);
  } finally {
    renderer.clear();
    await window.happyDOM.close();
  }
});

test('comments disarm image requests, wiki embeds, HTML resources, and named code processors before rendering', async () => {
  const window = new Window();
  const body = window.document.createElement('div');
  const renderer = new CommentMarkdown();
  const calls = [];
  const app = {
    async renderMarkdown(text) {
      calls.push(text);
    },
  };
  const source = [
    '**Formatting** and [ordinary link](https://example.com) and [[local note]] and $x^2$.',
    '![remote](https://example.com/collect?secret=note)',
    '![reference][remote]',
    '[remote]: https://example.com/reference.png',
    '![[private note#section]]',
    '<img src="https://example.com/image" onerror="alert(1)">',
    '<iframe src="https://example.com/frame"></iframe>',
    '<style>@import "https://example.com/style";</style>',
    '<div>![nested](https://example.com/nested)</div>',
    '```dataviewjs',
    'fetch("https://example.com/code");',
    '```',
  ].join('\n\n');
  renderer.paint(app, body, source, 'Fixtures/Annotations.md');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const forwarded = calls[0];
  assert.ok(
    forwarded.includes(
      '**Formatting** and [ordinary link](https://example.com) and [[local note]] and $x^2$.',
    ),
  );
  assert.ok(forwarded.includes('\\!\\[remote\\]'));
  assert.ok(forwarded.includes('\\![[private note') || forwarded.includes('\\!\\[\\[private note'));
  assert.ok(forwarded.includes('&lt;img'));
  assert.ok(!forwarded.includes('```dataviewjs'));
  assert.ok(forwarded.includes('fetch("https://example.com/code");'));
  const active = [];
  parser.parse(forwarded).iterate({
    enter(node) {
      if (['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) {
        assert.equal(node.node.getChild('CodeInfo'), null);
        return false;
      }
      if (['Image', 'HTMLBlock', 'HTMLTag'].includes(node.name)) active.push(node.name);
    },
  });
  assert.deepEqual(active, []);
  assert.ok(source.includes('```dataviewjs'));
  assert.ok(source.includes('<img src='));
  renderer.clear();
  await window.happyDOM.close();
});

test('sanitizing preserves literal examples inside code and strips nested and unclosed fence processors', () => {
  const inline = '`![image](https://example.com) ![[note]] <img src=x>`';
  const indented = '    ![image](https://example.com) ![[note]] <img src=x>';
  assert.equal(safeCommentMarkdown(inline), inline);
  assert.equal(safeCommentMarkdown(indented), indented);
  assert.equal(
    safeCommentMarkdown('```dataviewjs\n![[note]] <img src=x>\n```'),
    '```\n![[note]] <img src=x>\n```',
  );
  assert.equal(
    safeCommentMarkdown('> ~~~mermaid\n> graph TD; a-->b\n> ~~~'),
    '> ~~~\n> graph TD; a-->b\n> ~~~',
  );
  assert.equal(safeCommentMarkdown('```dataviewjs\nfetch("secret")'), '```\nfetch("secret")');
  assert.equal(safeCommentMarkdown('\\![[escaped]]'), '\\![[escaped]]');
  assert.equal(safeCommentMarkdown('![[unfinished embed'), '\\![[unfinished embed');
});

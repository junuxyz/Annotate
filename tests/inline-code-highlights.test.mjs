import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Window } from './dom.mjs';

const output = new URL('./.inline-code-highlights.mjs', import.meta.url);
await build({
  stdin: {
    contents:
      "export { inlineCodeHighlights } from './src/inline-code-highlights.ts'; export { editorLivePreviewField } from 'obsidian';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  outfile: output.pathname,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: new URL('./host.mjs', import.meta.url).pathname },
  external: ['@codemirror/state', '@codemirror/view'],
});
const { inlineCodeHighlights, editorLivePreviewField } = await import(output.href);
after(() => unlink(output));

const source = '<mark data-annotate-highlight="yellow">before `W~` after</mark>\n\noutside';
function widgets(state) {
  return state.facet(EditorView.decorations).flatMap((decorations) => {
    if (typeof decorations === 'function') return [];
    const values = [];
    for (const cursor = decorations.iter(); cursor.value; cursor.next())
      if (cursor.value.spec.widget) values.push(cursor.value.spec.widget);
    return values;
  });
}
function state(app, live = true, doc = source) {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [
      editorLivePreviewField.init(() => live),
      inlineCodeHighlights(app, () => 'test.md'),
    ],
  });
}

test('inline code uses one Markdown widget in Live Preview and exposes source for editing', () => {
  const initial = state({});
  assert.equal(widgets(initial).length, 1);
  assert.equal(widgets(state({}, false)).length, 0);
  assert.equal(widgets(state({}, true, 'unhighlighted `code`')).length, 0);
  assert.equal(
    widgets(initial.update({ selection: { anchor: source.indexOf('W~') } }).state).length,
    0,
  );
  const switched = initial.update({
    effects: StateEffect.reconfigure.of([
      editorLivePreviewField.init(() => false),
      inlineCodeHighlights({}, () => 'test.md'),
    ]),
  });
  assert.equal(widgets(switched.state).length, 0);
  const nested = state(
    {},
    true,
    source.replace('`W~`', '<span data-annotate-color="red">`W~`</span>'),
  );
  assert.equal(widgets(nested).length, 1, 'the outer wrapper owns the nested render');
});

test('Markdown widget passes unchanged source to the host and disposes asynchronous renders', async () => {
  const win = new Window();
  const calls = [];
  const app = {
    renderMarkdown(text, element, path, component) {
      return new Promise((resolve, reject) =>
        calls.push({ text, element, path, component, resolve, reject }),
      );
    },
  };
  let measures = 0;
  const view = { dom: win.document.createElement('div'), requestMeasure: () => measures++ };
  const widget = widgets(state(app))[0];
  const dom = widget.toDOM(view);
  assert.equal(calls[0].text, source.slice(0, source.indexOf('\n')));
  assert.equal(calls[0].path, 'test.md');
  calls[0].element.innerHTML = '<p><mark>before <code>W~</code> after</mark></p>';
  calls[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.querySelector('code').textContent, 'W~');
  assert.equal(dom.querySelector('p'), null, 'the rendered widget stays inline');
  assert.equal(measures, 1);
  const equivalent = widgets(state(app))[0];
  assert.ok(widget.eq(equivalent));
  equivalent.destroy(dom);
  assert.equal(calls[0].component.loaded, false);
  const removed = widget.toDOM(view);
  widget.destroy(removed);
  calls[1].element.innerHTML = '<p>stale</p>';
  calls[1].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(removed.textContent, '');
  assert.equal(calls[1].component.loaded, false);
  const fallback = widget.toDOM(view);
  calls[2].reject(new Error('renderer unavailable'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fallback.textContent, calls[2].text);
  assert.equal(calls[2].component.loaded, false);
  widget.destroy(fallback);
});

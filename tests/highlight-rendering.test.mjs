import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Window } from './dom.mjs';

const output = new URL('./.highlight-rendering.mjs', import.meta.url);
await build({
  stdin: {
    contents:
      "export { highlightRendering, joinHighlightEdges, outsideHighlightRendering, renderStyledSelection } from './src/highlight-rendering.ts'; export { editorLivePreviewField } from 'obsidian';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  outfile: output.pathname,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: new URL('./host.mjs', import.meta.url).pathname },
  external: ['@codemirror/state', '@codemirror/view'],
});
const {
  highlightRendering,
  joinHighlightEdges,
  outsideHighlightRendering,
  renderStyledSelection,
  editorLivePreviewField,
} = await import(output.href);
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
    extensions: [editorLivePreviewField.init(() => live), highlightRendering(app, () => 'test.md')],
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
      highlightRendering({}, () => 'test.md'),
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

test('highlighting a link keeps its complete Markdown context for the native renderer', () => {
  const link =
    '[<mark data-annotate-highlight="yellow">Native Sparse Attention</mark>](https://example.test/paper)';
  const highlighted = state({}, true, link + '\n\noutside');
  const rendered = widgets(highlighted);
  assert.equal(rendered.length, 1);
  assert.equal(
    rendered[0].text,
    link,
    'render the anchor and its destination together with the highlight',
  );
});

test('partial labels, nested formatting and adjacent wrappers render once with their native context', () => {
  for (const syntax of [
    '[before <mark data-annotate-highlight="yellow">label</mark> after](https://example.test)',
    '**before <span data-annotate-color="red">bold</span> after**',
    '*<mark data-annotate-highlight="yellow">italic</mark>*',
    '~~<mark data-annotate-highlight="yellow">deleted</mark>~~',
    '[<mark data-annotate-highlight="yellow">**bold**</mark> and <span data-annotate-color="blue">`code`</span>](Target.md)',
    '<mark data-annotate-highlight="yellow">[[Target|alias]] and $x^2$</mark>',
  ]) {
    const rendered = widgets(state({}, true, syntax + '\n\noutside'));
    assert.equal(rendered.length, 1, syntax);
    assert.equal(rendered[0].text, syntax);
  }
});

test('comment controls escape expanded link and emphasis renders', () => {
  for (const syntax of [
    '[<mark data-annotate-highlight="yellow">label</mark>](https://example.test)',
    '**<mark data-annotate-highlight="yellow">bold</mark>**',
  ]) {
    const rendered = state({}, true, syntax + '\n\noutside');
    const position = syntax.indexOf('</mark>') + '</mark>'.length;
    assert.equal(outsideHighlightRendering(rendered, position), syntax.length);
    assert.equal(outsideHighlightRendering(rendered, syntax.length + 1), syntax.length + 1);
    const editing = rendered.update({
      selection: { anchor: syntax.indexOf('data-annotate') },
    }).state;
    assert.equal(outsideHighlightRendering(editing, position), position);
  }
});

test('applying style retains native UI for the current selection, then yields to editing', () => {
  const initial = state({});
  const position = source.indexOf('W~');
  const selected = initial.update({ selection: { anchor: position, head: position + 2 } }).state;
  assert.equal(widgets(selected).length, 0);
  const styled = selected.update({ effects: renderStyledSelection.of(null) }).state;
  assert.equal(widgets(styled).length, 1);
  assert.equal(styled.selection.main.from, position);
  assert.equal(styled.selection.main.to, position + 2);
  const editing = styled.update({ selection: { anchor: position + 1 } }).state;
  assert.equal(widgets(editing).length, 0);
});

test('saved highlight fragments join across emphasis without replacing native UI', () => {
  const win = new Window();
  const root = win.document.createElement('div');
  const mark = (text) => `<mark data-annotate-highlight="yellow">${text}</mark>`;
  root.innerHTML = `<p>${mark('합성 문장 앞부분은 ')}<strong>${mark('테스트강조')}</strong>${mark('와 이어짐.')}</p>`;
  const strong = root.querySelector('strong');
  joinHighlightEdges(root);
  assert.deepEqual(
    [...root.querySelectorAll('mark')].map((el) => el.dataset.annotateFragment),
    ['start', 'middle', 'end'],
  );
  assert.equal(root.querySelector('strong'), strong, 'retain native elements and event handlers');
  const html = root.innerHTML;
  joinHighlightEdges(root);
  assert.equal(root.innerHTML, html, 'repeated postprocessing is stable');
  strong.remove();
  joinHighlightEdges(root);
  assert.deepEqual(
    [...root.querySelectorAll('mark')].map((el) => el.dataset.annotateFragment),
    ['start', 'end'],
  );
  root.querySelector('mark').remove();
  joinHighlightEdges(root);
  assert.equal(
    root.querySelector('mark').hasAttribute('data-annotate-fragment'),
    false,
    'reused widgets recover their original corners when separated',
  );
});

test('separate highlights keep corners at unpainted content, color changes and block boundaries', () => {
  const win = new Window();
  const root = win.document.createElement('div');
  const mark = (id = 'yellow') => `<mark data-annotate-highlight="${id}">text</mark>`;
  for (const gap of [
    ' ',
    'plain',
    '<br>',
    '<img src="synthetic.svg">',
    '<span><svg></svg></span>',
    '<input>',
  ]) {
    root.innerHTML = `<p>${mark()}${gap}${mark()}</p>`;
    joinHighlightEdges(root);
    assert.ok(
      [...root.querySelectorAll('mark')].every((el) => !el.hasAttribute('data-annotate-fragment')),
      gap,
    );
  }
  for (const html of [
    `<p>${mark()}${mark('pink')}</p>`,
    `<p>${mark()}</p><p>${mark()}</p>`,
    `<ul><li>${mark()}</li><li>${mark()}</li></ul>`,
  ]) {
    root.innerHTML = html;
    joinHighlightEdges(root);
    assert.ok(
      [...root.querySelectorAll('mark')].every((el) => !el.hasAttribute('data-annotate-fragment')),
      html,
    );
  }
});

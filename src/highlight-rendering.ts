import './dom';
import { Prec, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { Component, MarkdownRenderer, editorLivePreviewField, type App } from 'obsidian';
import { noteHighlights } from './highlight';
import { parser, GFM } from '@lezer/markdown';

const renders = new WeakMap<HTMLElement, Component>();
const markdown = parser.configure([GFM]);
export const renderStyledSelection = StateEffect.define<null>();

const savedFragments = new WeakMap<HTMLElement, string | null>();

/** Older notes have separate marks around emphasis without joined-edge metadata. */
export function joinHighlightEdges(root: HTMLElement): void {
  const selector = '[data-annotate-highlight]';
  const marks = [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (mark) => !mark.parentElement?.closest(selector),
  );
  const edges = marks.map((mark) => {
    if (!savedFragments.has(mark))
      savedFragments.set(mark, mark.getAttribute('data-annotate-fragment'));
    const fragment = savedFragments.get(mark);
    return {
      start: fragment !== 'middle' && fragment !== 'end',
      end: fragment !== 'middle' && fragment !== 'start',
    };
  });
  const block = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, .cm-line';
  for (let index = 1; index < marks.length; index++) {
    const left = marks[index - 1],
      right = marks[index];
    const leftEdge = edges[index - 1],
      rightEdge = edges[index];
    if (
      !left ||
      !right ||
      !leftEdge ||
      !rightEdge ||
      left.dataset.annotateHighlight !== right.dataset.annotateHighlight ||
      left.closest(block) !== right.closest(block)
    )
      continue;
    const gap = root.ownerDocument.createRange();
    gap.setStartAfter(left);
    gap.setEndBefore(right);
    const contents = gap.cloneContents();
    // Empty formatting containers are safe to join; unpainted content is a boundary.
    if (
      contents.textContent ||
      contents.querySelector('br, img, svg, math, input, video, audio, iframe, canvas')
    )
      continue;
    leftEdge.end = false;
    rightEdge.start = false;
  }
  marks.forEach((mark, index) => {
    const edge = edges[index];
    if (!edge) return;
    if (edge.start && edge.end) mark.removeAttribute('data-annotate-fragment');
    else mark.dataset.annotateFragment = edge.start ? 'start' : edge.end ? 'end' : 'middle';
  });
}

/** Render styling with its surrounding Markdown so native links and inline UI survive. */
class HighlightedMarkdown extends WidgetType {
  constructor(
    readonly app: App,
    readonly text: string,
    readonly path: string,
  ) {
    super();
  }

  eq(other: HighlightedMarkdown): boolean {
    return this.app === other.app && this.text === other.text && this.path === other.path;
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = view.dom.ownerDocument.win.createSpan();
    dom.className = 'annotate-inline-markdown';
    const content = dom.ownerDocument.win.createSpan();
    content.className = 'markdown-rendered';
    const component = new Component();
    component.load();
    renders.set(dom, component);
    void MarkdownRenderer.render(this.app, this.text, content, this.path, component)
      .then(() => {
        if (renders.get(dom) !== component) return;
        for (const paragraph of content.querySelectorAll('p'))
          paragraph.replaceWith(...paragraph.childNodes);
        dom.replaceChildren(content);
        joinHighlightEdges(content);
        view.requestMeasure();
      })
      .catch(() => {
        if (renders.get(dom) !== component) return;
        dom.textContent = this.text;
        component.unload();
        renders.delete(dom);
      });
    return dom;
  }

  destroy(dom: HTMLElement): void {
    renders.get(dom)?.unload();
    renders.delete(dom);
  }
}

export function highlightRendering(app: App, path: (state: EditorState) => string) {
  const cache = new WeakMap<EditorState['doc'], { from: number; to: number }[]>();
  const decorations = (state: EditorState, renderSelected = false) => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    let wrappers = cache.get(state.doc);
    if (!wrappers) {
      const source = state.doc.toString();
      const ranges = [...noteHighlights(source), ...noteHighlights(source, 'span')].map(
        (range) => ({ from: range.tagFrom, to: range.tagTo }),
      );
      // Formatting tags inside a label must render with the complete anchor, not replace it.
      markdown.parse(source).iterate({
        enter(node) {
          if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name))
            return false;
          if (
            !['Link', 'Image', 'Autolink', 'Emphasis', 'StrongEmphasis', 'Strikethrough'].includes(
              node.name,
            )
          )
            return;
          for (const range of ranges) {
            if (range.from < node.to && range.to > node.from) {
              range.from = Math.min(range.from, node.from);
              range.to = Math.max(range.to, node.to);
            }
          }
        },
      });
      wrappers = [];
      for (const range of ranges.sort((a, b) => a.from - b.from || b.to - a.to)) {
        const previous = wrappers.at(-1);
        if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
        else wrappers.push(range);
      }
      cache.set(state.doc, wrappers);
    }
    return Decoration.set(
      wrappers
        .filter(
          (range) =>
            renderSelected ||
            !state.selection.ranges.some(
              (selection) => selection.from <= range.to && selection.to >= range.from,
            ),
        )
        .map((range) =>
          Decoration.replace({
            widget: new HighlightedMarkdown(app, state.sliceDoc(range.from, range.to), path(state)),
          }).range(range.from, range.to),
        ),
      true,
    );
  };
  return Prec.highest(
    StateField.define({
      create: (state) => ({ decorations: decorations(state), renderSelected: false }),
      update(value, transaction) {
        const renderSelected =
          transaction.effects.some((effect) => effect.is(renderStyledSelection)) ||
          (!(transaction.docChanged || transaction.selection) && value.renderSelected);
        return transaction.docChanged ||
          transaction.selection ||
          transaction.reconfigured ||
          renderSelected !== value.renderSelected ||
          transaction.startState.field(editorLivePreviewField, false) !==
            transaction.state.field(editorLivePreviewField, false) ||
          path(transaction.startState) !== path(transaction.state)
          ? { decorations: decorations(transaction.state, renderSelected), renderSelected }
          : value;
      },
      provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
    }),
  );
}

/** Comment controls must stay outside the rendered component that contains their anchor. */
export function outsideHighlightRendering(state: EditorState, position: number): number {
  let end = position;
  for (const decorations of state.facet(EditorView.decorations)) {
    if (typeof decorations === 'function') continue;
    decorations.between(position, position, (from, to, value) => {
      const spec: unknown = value.spec;
      if (
        from < position &&
        to > position &&
        typeof spec === 'object' &&
        spec !== null &&
        'widget' in spec &&
        spec.widget instanceof HighlightedMarkdown
      )
        end = Math.max(end, to);
    });
  }
  return end;
}

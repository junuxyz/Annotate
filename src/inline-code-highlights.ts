import './dom';
import { Prec, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { Component, MarkdownRenderer, editorLivePreviewField, type App } from 'obsidian';
import { inlineCodeRanges, noteHighlights } from './highlight';

const renders = new WeakMap<HTMLElement, Component>();

/** Native inline HTML widgets display backticks literally. Render these wrappers as Markdown. */
class InlineCodeHighlight extends WidgetType {
  constructor(
    readonly app: App,
    readonly text: string,
    readonly path: string,
  ) {
    super();
  }

  eq(other: InlineCodeHighlight): boolean {
    return this.app === other.app && this.text === other.text && this.path === other.path;
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = view.dom.ownerDocument.win.createSpan();
    dom.className = 'annotate-inline-code-highlight';
    const content = dom.ownerDocument.win.createDiv();
    const component = new Component();
    component.load();
    renders.set(dom, component);
    void MarkdownRenderer.render(this.app, this.text, content, this.path, component)
      .then(() => {
        if (renders.get(dom) !== component) return;
        for (const paragraph of content.querySelectorAll('p'))
          paragraph.replaceWith(...paragraph.childNodes);
        dom.replaceChildren(...content.childNodes);
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

  ignoreEvent(): boolean {
    return false;
  }
}

export function inlineCodeHighlights(app: App, path: (state: EditorState) => string) {
  const cache = new WeakMap<EditorState['doc'], ReturnType<typeof noteHighlights>>();
  const decorations = (state: EditorState) => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    let wrappers = cache.get(state.doc);
    if (!wrappers) {
      const source = state.doc.toString();
      const codes = inlineCodeRanges(source);
      const candidates = codes.length
        ? [...noteHighlights(source), ...noteHighlights(source, 'span')].filter((range) =>
            codes.some((code) => code.from >= range.from && code.to <= range.to),
          )
        : [];
      wrappers = candidates.filter(
        (range) =>
          !candidates.some((outer) => outer.tagFrom < range.tagFrom && outer.tagTo > range.tagTo),
      );
      cache.set(state.doc, wrappers);
    }
    return Decoration.set(
      wrappers
        .filter(
          (range) =>
            !state.selection.ranges.some(
              (selection) => selection.from <= range.to && selection.to >= range.from,
            ),
        )
        .map((range) =>
          Decoration.replace({
            widget: new InlineCodeHighlight(
              app,
              state.sliceDoc(range.tagFrom, range.tagTo),
              path(state),
            ),
          }).range(range.tagFrom, range.tagTo),
        ),
      true,
    );
  };
  return Prec.highest(
    StateField.define({
      create: decorations,
      update(value, transaction) {
        return transaction.docChanged ||
          transaction.selection ||
          transaction.reconfigured ||
          transaction.startState.field(editorLivePreviewField, false) !==
            transaction.state.field(editorLivePreviewField, false) ||
          path(transaction.startState) !== path(transaction.state)
          ? decorations(transaction.state)
          : value;
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
  );
}

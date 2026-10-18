import './dom';
import { decodeHTMLStrict } from 'entities';
import { highlightSyntax } from './highlight';
import type { Anchor } from './model';
import { mathParts } from './math';

export type SourcePoint = { from: number; to: number };
export type DomPoint = { node: Text; offset: number };
type Projection<T> = { text: string; points: T[] };
type ProjectionBuilder<T> = { chars: string[]; points: T[] };

function append<T>(projection: ProjectionBuilder<T>, char: string, point: T): void {
  if (/\s/.test(char)) {
    if (!projection.chars.length || projection.chars.at(-1) === ' ') return;
    char = ' ';
  }
  projection.chars.push(char);
  projection.points.push(point);
}

function finish<T>(projection: ProjectionBuilder<T>): Projection<T> {
  if (projection.chars.at(-1) === ' ') {
    projection.chars.pop();
    projection.points.pop();
  }
  return { text: projection.chars.join(''), points: projection.points };
}

export function projectSource(source: string, _doc?: Document): Projection<SourcePoint> {
  const hidden = new Uint8Array(source.length);
  const replacements = new Map<number, { end: number; text: string }>();
  const hide = (from: number, to: number) => hidden.fill(1, from, to);
  let mathOffset = 0;
  for (const part of mathParts(source)) {
    if (part.kind === 'math') hide(mathOffset, mathOffset + part.text.length);
    mathOffset += part.text.length;
  }

  const syntax = highlightSyntax(source);
  for (const tag of syntax.tags) hide(tag.from, tag.to);
  syntax.tree.iterate({
    enter(node) {
      const from = syntax.from(node.from),
        to = syntax.to(node.to);
      if (
        [
          'EmphasisMark',
          'HeaderMark',
          'LinkMark',
          'QuoteMark',
          'ListMark',
          'CodeMark',
          'CodeInfo',
          'StrikethroughMark',
          'TableDelimiter',
          'TaskMarker',
          'HorizontalRule',
          'LinkReference',
          'Image',
          'HTMLTag',
        ].includes(node.name)
      ) {
        hide(from, to);
        return false;
      }
      if (
        ['URL', 'LinkTitle', 'LinkLabel'].includes(node.name) &&
        node.node.parent?.name === 'Link'
      )
        hide(from, to);
      if (node.name === 'Escape') hide(from, from + 1);
      if (node.name === 'Entity') {
        replacements.set(from, {
          end: to,
          text: decodeHTMLStrict(source.slice(from, to)),
        });
      }
    },
  });
  for (const match of source.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    const from = match.index,
      content = match[1];
    if (content === undefined) continue;
    if (match[0].startsWith('!')) {
      hide(from, from + match[0].length);
      continue;
    }
    const alias = content.lastIndexOf('|');
    hide(from, from + 2 + (alias >= 0 ? alias + 1 : 0));
    hide(from + match[0].length - 2, from + match[0].length);
  }
  const projected: ProjectionBuilder<SourcePoint> = { chars: [], points: [] };
  for (let i = 0; i < source.length; i++) {
    const replacement = replacements.get(i);
    if (replacement && !hidden[i]) {
      for (let j = 0; j < replacement.text.length; j++)
        append(projected, replacement.text.charAt(j), { from: i, to: replacement.end });
      i = replacement.end - 1;
    } else if (!hidden[i]) append(projected, source.charAt(i), { from: i, to: i + 1 });
  }
  return finish(projected);
}

export function projectDom(root: HTMLElement): Projection<DomPoint | null> {
  const doc = root.ownerDocument,
    win = doc.defaultView;
  const projected: ProjectionBuilder<DomPoint | null> = { chars: [], points: [] };
  if (!win) return finish(projected);
  const blocks = new Set([
    'P',
    'DIV',
    'LI',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'PRE',
    'TR',
    'TD',
    'TH',
  ]);
  const visit = (node: Node): void => {
    if (node.instanceOf(win.Text)) {
      const text = node.data;
      for (let offset = 0; offset < text.length; offset++)
        append(projected, text.charAt(offset), { node, offset });
      return;
    }
    if (!node.instanceOf(win.HTMLElement)) return;
    if (
      node.matches(
        'button, script, style, .annotate-count, .copy-code-button, .markdown-embed, .callout-title, .math, .math-block',
      )
    )
      return;
    if (node.tagName === 'BR' || blocks.has(node.tagName)) append(projected, ' ', null);
    for (const child of node.childNodes) visit(child);
    if (blocks.has(node.tagName)) append(projected, ' ', null);
  };
  visit(root);
  return finish(projected);
}

export function sectionBounds(source: string, lineStart: number, lineEnd: number): SourcePoint {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charAt(i) === '\n') starts.push(i + 1);
  return { from: starts[lineStart] ?? source.length, to: starts[lineEnd + 1] ?? source.length };
}

export function sectionMapping(root: HTMLElement, source: string, bounds: SourcePoint) {
  const rendered = projectDom(root);
  const projected = projectSource(source.slice(bounds.from, bounds.to), root.ownerDocument);
  if (!rendered.text) return null;
  const offset = projected.text.indexOf(rendered.text);
  if (offset < 0 || projected.text.indexOf(rendered.text, offset + 1) >= 0) return null;
  return {
    rendered,
    sourcePoints: projected.points
      .slice(offset, offset + rendered.text.length)
      .map((point) => ({ from: point.from + bounds.from, to: point.to + bounds.from })),
  };
}

export function clearReadingMarks(root: HTMLElement): void {
  for (const badge of root.querySelectorAll('.annotate-reading-count')) badge.remove();
  for (const mark of root.querySelectorAll('.annotate-reading-mark'))
    mark.replaceWith(...mark.childNodes);
  root.normalize();
}

export function markReadingAnchor(
  root: HTMLElement,
  source: string,
  bounds: SourcePoint,
  anchor: Anchor,
  className: string,
  id?: string,
): HTMLElement[] {
  const mapping = sectionMapping(root, source, bounds);
  if (!mapping) return [];
  const groups = new Map<Text, { from: number; to: number }>();
  for (let index = 0; index < mapping.sourcePoints.length; index++) {
    const sourcePoint = mapping.sourcePoints[index],
      domPoint = mapping.rendered.points[index];
    if (!sourcePoint || !domPoint || sourcePoint.from >= anchor.to || sourcePoint.to <= anchor.from)
      continue;
    const group = groups.get(domPoint.node);
    if (group) group.to = domPoint.offset + 1;
    else groups.set(domPoint.node, { from: domPoint.offset, to: domPoint.offset + 1 });
  }
  const marks: HTMLElement[] = [];
  for (const [node, group] of groups) {
    const range = root.ownerDocument.createRange();
    range.setStart(node, group.from);
    range.setEnd(node, group.to);
    const mark = root.ownerDocument.win.createSpan();
    mark.className = 'annotate-reading-mark ' + className;
    if (id) mark.dataset.annotateThread = id;
    range.surroundContents(mark);
    marks.push(mark);
  }
  return marks;
}

export function selectedSourceRange(
  root: HTMLElement,
  source: string,
  bounds: SourcePoint,
  range: Range,
): SourcePoint | null {
  const mapping = sectionMapping(root, source, bounds);
  if (!mapping) return null;
  let result: SourcePoint | null = null;
  for (let index = 0; index < mapping.sourcePoints.length; index++) {
    const point = mapping.rendered.points[index],
      sourcePoint = mapping.sourcePoints[index];
    if (
      !point ||
      !sourcePoint ||
      !range.isPointInRange(point.node, point.offset) ||
      !range.isPointInRange(point.node, point.offset + 1)
    )
      continue;
    if (result) result.to = sourcePoint.to;
    else result = { ...sourcePoint };
  }
  return result;
}

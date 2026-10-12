import { parser, GFM } from '@lezer/markdown';
import type { Anchor } from './model';

export type SourcePoint = { from: number; to: number };
export type DomPoint = { node: Text; offset: number };
type Projection<T> = { text: string; points: T[] };
const markdown = parser.configure([GFM]);

function normalized<T>(chars: { char: string; point: T }[]): Projection<T> {
  let text = '';
  const points: T[] = [];
  for (const { char, point } of chars) {
    if (/\s/.test(char)) {
      if (!text || text.endsWith(' ')) continue;
      text += ' ';
    } else text += char;
    points.push(point);
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    points.pop();
  }
  return { text, points };
}

export function projectSource(source: string, doc: Document): Projection<SourcePoint> {
  const hidden = new Uint8Array(source.length);
  const replacements = new Map<number, { end: number; text: string }>();
  const hide = (from: number, to: number) => hidden.fill(1, from, to);
  markdown.parse(source).iterate({
    enter(node) {
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
        hide(node.from, node.to);
        return false;
      }
      if (
        ['URL', 'LinkTitle', 'LinkLabel'].includes(node.name) &&
        node.node.parent?.name === 'Link'
      )
        hide(node.from, node.to);
      if (node.name === 'Escape') hide(node.from, node.from + 1);
      if (node.name === 'Entity') {
        const entity = doc.createElement('textarea');
        entity.innerHTML = source.slice(node.from, node.to);
        replacements.set(node.from, { end: node.to, text: entity.value });
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
  const chars: { char: string; point: SourcePoint }[] = [];
  for (let i = 0; i < source.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      for (let j = 0; j < replacement.text.length; j++)
        chars.push({ char: replacement.text.charAt(j), point: { from: i, to: replacement.end } });
      i = replacement.end - 1;
    } else if (!hidden[i]) chars.push({ char: source.charAt(i), point: { from: i, to: i + 1 } });
  }
  return normalized(chars);
}

export function projectDom(root: HTMLElement): Projection<DomPoint | null> {
  const doc = root.ownerDocument,
    win = doc.defaultView;
  const chars: { char: string; point: DomPoint | null }[] = [];
  if (!win) return { text: '', points: [] };
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
    if (node instanceof win.Text) {
      for (let offset = 0; offset < node.data.length; offset++)
        chars.push({ char: node.data.charAt(offset), point: { node, offset } });
      return;
    }
    if (!(node instanceof win.HTMLElement)) return;
    if (
      node.matches(
        'button, script, style, .annotate-count, .copy-code-button, .markdown-embed, .callout-title, .math, .math-block',
      )
    )
      return;
    if (node.tagName === 'BR' || blocks.has(node.tagName)) chars.push({ char: ' ', point: null });
    for (const child of node.childNodes) visit(child);
    if (blocks.has(node.tagName)) chars.push({ char: ' ', point: null });
  };
  visit(root);
  return normalized(chars);
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
    const mark = root.ownerDocument.createElement('span');
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

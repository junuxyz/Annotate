import { z } from 'zod';
import { parser, GFM } from '@lezer/markdown';
import { ChangeSet } from '@codemirror/state';

export const highlightShapes = { rounded: 'Rounded', flat: 'Flat', underline: 'Underline' };
export const highlightSettingsSchema = z.object({
  colors: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]*$/),
        name: z.string().trim().min(1),
        value: z.string().regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i),
      }),
    )
    .min(1)
    .max(20)
    .refine((colors) => new Set(colors.map((color) => color.id)).size === colors.length),
  shape: z.enum(['rounded', 'flat', 'underline']),
  recent: z.string(),
  textRecent: z.string().default('red'),
});
export type HighlightSettings = z.infer<typeof highlightSettingsSchema>;
export type HighlightColor = HighlightSettings['colors'][number];
export const defaultHighlights = (): HighlightSettings => ({
  colors: [
    { id: 'yellow', name: 'Yellow', value: '#ffe06680' },
    { id: 'pink', name: 'Pink', value: '#ff8fc780' },
    { id: 'light-blue', name: 'Light blue', value: '#83c9ff80' },
  ],
  shape: 'rounded',
  recent: 'yellow',
  textRecent: 'red',
});
export function highlightStyle(value: string, shape: HighlightSettings['shape']): string {
  if (shape === 'underline')
    return `background: transparent; box-shadow: inset 0 -0.2em ${value}; border-radius: 0;`;
  return `background: ${value}; box-shadow: none; border-radius: ${shape === 'rounded' ? '0.2em' : '0'};`;
}
function opening(color: HighlightColor, shape: HighlightSettings['shape']): string {
  return `<mark data-annotate-highlight="${color.id}" style="${highlightStyle(color.value, shape)}">`;
}

/** Text colors follow the active theme, so they stay readable in light and dark notes. */
export const textColors = [
  { id: 'gray', name: 'Gray', value: 'var(--text-muted, #787774)' },
  { id: 'red', name: 'Red', value: 'var(--color-red, #e03e3e)' },
  { id: 'orange', name: 'Orange', value: 'var(--color-orange, #d9730d)' },
  { id: 'yellow', name: 'Yellow', value: 'var(--color-yellow, #cb912f)' },
  { id: 'green', name: 'Green', value: 'var(--color-green, #448361)' },
  { id: 'blue', name: 'Blue', value: 'var(--color-blue, #337ea9)' },
  { id: 'purple', name: 'Purple', value: 'var(--color-purple, #9065b0)' },
  { id: 'pink', name: 'Pink', value: 'var(--color-pink, #c14c8a)' },
] as const;
export type TextColor = (typeof textColors)[number];
export function textColorOpening(color: TextColor): string {
  return `<span data-annotate-color="${color.id}" style="color: ${color.value};">`;
}

export type WrapTag = 'mark' | 'span';
const owners: Record<WrapTag, RegExp> = {
  mark: /^<mark(?:\s|>)/i,
  span: /^<span\b[^>]*\bdata-annotate-color=/i,
};
type Mark = { from: number; start: number; end: number; to: number; open: string };
type Open = { from: number; start: number; open: string; depth: number };
const markdown = parser.configure([GFM]);
const opens = (tag: WrapTag) => new RegExp(`^<${tag}(?:\\s|>)`, 'i');
const closes = (tag: WrapTag) => new RegExp(`^</${tag}\\s*>$`, 'i');

/** One replacement keeps recoloring, partial removal, and undo atomic. */
export function highlightEdit(
  source: string,
  from: number,
  to: number,
  color: HighlightColor | null,
  shape: HighlightSettings['shape'],
): ReturnType<typeof wrapEdit> {
  return wrapEdit(source, from, to, color ? opening(color, shape) : null, 'mark');
}
export function textColorEdit(
  source: string,
  from: number,
  to: number,
  color: TextColor | null,
): ReturnType<typeof wrapEdit> {
  return wrapEdit(source, from, to, color ? textColorOpening(color) : null, 'span');
}

/** Wraps, rewraps, or unwraps one plugin-owned inline tag kind around a source range. */
export function wrapEdit(
  source: string,
  from: number,
  to: number,
  open: string | null,
  tag: WrapTag,
): { from: number; to: number; insert: string; selectionFrom: number; selectionTo: number } | null {
  if (from < 0 || to > source.length || from >= to || !source.slice(from, to).trim()) return null;
  const marks: (Mark & { depth: number; owned: boolean })[] = [];
  const stack: Open[] = [];
  let invalid = false;
  markdown.parse(source).iterate({
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) {
        if (node.from < to && node.to > from) invalid = true;
        return false;
      }
      if (node.name !== 'HTMLTag') return;
      const text = source.slice(node.from, node.to);
      if ((from > node.from && from < node.to) || (to > node.from && to < node.to)) invalid = true;
      if (opens(tag).test(text))
        stack.push({ from: node.from, start: node.to, open: text, depth: stack.length });
      else if (closes(tag).test(text)) {
        const active = stack.pop();
        if (active)
          marks.push({
            ...active,
            end: node.from,
            to: node.to,
            owned: owners[tag].test(active.open),
          });
      }
    },
  });
  const overlaps = marks
    .filter((mark) => mark.from < to && mark.to > from)
    .sort((a, b) => a.from - b.from);
  // Nested, foreign, or unclosed tags around the selection cannot be rewrapped safely.
  if (
    invalid ||
    stack.some((active) => active.from < to) ||
    overlaps.some(
      (mark) =>
        mark.depth > 0 ||
        !mark.owned ||
        marks.some((inner) => inner !== mark && inner.from > mark.from && inner.to < mark.to),
    )
  )
    return null;
  const first = overlaps[0],
    last = overlaps.at(-1);
  const start = Math.min(from, first?.from ?? from),
    end = Math.max(to, last?.to ?? to);
  const strip = (a: number, b: number) => {
    let text = '',
      cursor = a;
    for (const mark of overlaps) {
      for (const [x, y] of [
        [mark.from, mark.start],
        [mark.end, mark.to],
      ]) {
        if (x === undefined || y === undefined || y <= cursor || x >= b) continue;
        text += source.slice(cursor, Math.max(cursor, x));
        cursor = Math.min(b, y);
      }
    }
    return text + source.slice(cursor, b);
  };
  const close = `</${tag}>`;
  const wrap = (text: string, opener: string) =>
    text
      .split('\n')
      .map((line) => {
        // Keep block syntax outside inline HTML so headings and lists still render.
        const match = /^(\s*(?:(?:>\s*)+)?(?:(?:#{1,6}|[-+*]|\d+[.)])\s+)?)(.*?)(\s*)$/.exec(line);
        if (!match?.[2]) return line;
        // Wrap around other inline tags so mark and span stay properly nested.
        const body = match[2]
          .split(/(<\/?(?:mark|span)\b[^>]*>)/i)
          .map((part, index) => (index % 2 || !part ? part : `${opener}${part}${close}`))
          .join('');
        return `${match[1] ?? ''}${body}${match[3] ?? ''}`;
      })
      .join('\n');
  const before = strip(start, from),
    after = strip(to, end),
    selected = strip(from, to);
  const prefix = before && first && from > first.start ? wrap(before, first.open) : before;
  const suffix = after && last && to < last.end ? wrap(after, last.open) : after;
  const middle = open ? wrap(selected, open) : selected;
  const insert = prefix + middle + suffix;
  const selectedOffset = middle.indexOf(selected);
  const leading = open && middle.startsWith(open) ? open.length : 0,
    trailing = middle.endsWith(close) ? close.length : 0;
  return {
    from: start,
    to: end,
    insert,
    selectionFrom: start + prefix.length + (selectedOffset >= 0 ? selectedOffset : leading),
    selectionTo:
      start +
      prefix.length +
      (selectedOffset >= 0 ? selectedOffset + selected.length : middle.length - trailing),
  };
}

/** Tag edits change tags only; retain text positions for comments inside the selection. */
export function highlightChanges(
  source: string,
  edit: NonNullable<ReturnType<typeof wrapEdit>>,
  tag: WrapTag = 'mark',
): ChangeSet {
  const pattern = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
  const tokens = (text: string) => {
    const tags = new Map<number, { from: number; to: number; text: string }>();
    let plain = '',
      cursor = 0;
    for (const tag of text.matchAll(pattern)) {
      plain += text.slice(cursor, tag.index);
      const previous = tags.get(plain.length);
      tags.set(plain.length, {
        from: previous?.from ?? tag.index,
        to: tag.index + tag[0].length,
        text: (previous?.text ?? '') + tag[0],
      });
      cursor = tag.index + tag[0].length;
    }
    plain += text.slice(cursor);
    return { plain, tags };
  };
  const old = tokens(source.slice(edit.from, edit.to)),
    next = tokens(edit.insert);
  if (old.plain !== next.plain) throw new Error('Highlighting must preserve note text.');
  const boundaries = [...new Set([...old.tags.keys(), ...next.tags.keys()])].sort((a, b) => a - b);
  let offset = 0;
  const changes = boundaries.flatMap((index) => {
    const before = old.tags.get(index),
      after = next.tags.get(index);
    const from = before?.from ?? index + offset;
    offset += before?.text.length ?? 0;
    return before?.text === after?.text
      ? []
      : [
          {
            from: edit.from + from,
            to: edit.from + (before?.to ?? from),
            insert: after?.text ?? '',
          },
        ];
  });
  return ChangeSet.of(changes, source.length);
}

export function noteHighlights(
  source: string,
  tag: WrapTag = 'mark',
): { from: number; to: number; tagFrom: number; tagTo: number; id: string }[] {
  const attribute = tag === 'mark' ? 'data-annotate-highlight' : 'data-annotate-color';
  const idPattern = new RegExp(`\\b${attribute}=["']([a-z][a-z0-9-]*)["']`, 'i');
  const ranges: { from: number; to: number; tagFrom: number; tagTo: number; id: string }[] = [];
  const stack: { from: number; tagFrom: number; id: string }[] = [];
  markdown.parse(source).iterate({
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) return false;
      if (node.name !== 'HTMLTag') return;
      const text = source.slice(node.from, node.to);
      if (opens(tag).test(text)) {
        const id = idPattern.exec(text)?.[1] ?? '';
        stack.push({ from: node.to, tagFrom: node.from, id });
      } else if (closes(tag).test(text)) {
        const start = stack.pop();
        if (start?.id && node.from > start.from)
          ranges.push({
            from: start.from,
            to: node.from,
            tagFrom: start.tagFrom,
            tagTo: node.to,
            id: start.id,
          });
      }
    },
  });
  return ranges;
}

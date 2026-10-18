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
export function highlightStyle(
  value: string,
  shape: HighlightSettings['shape'],
  theme: 'light' | 'dark' = 'light',
): string {
  const background = theme === 'dark' ? `color-mix(in srgb, ${value} 45%, transparent)` : value;
  if (shape === 'underline')
    return `color: inherit; background: transparent; box-shadow: inset 0 -0.2em ${background}; border-radius: 0;`;
  return `color: inherit; background: ${background}; box-shadow: none; border-radius: ${shape === 'rounded' ? 'var(--annotate-highlight-radius, 0.2em)' : '0'};`;
}
export function highlightPaletteStyles(
  settings: Pick<HighlightSettings, 'colors' | 'shape'>,
): string {
  const fragments = `
[data-annotate-highlight][data-annotate-fragment="start"] { --annotate-highlight-radius: 0.2em 0 0 0.2em; }
[data-annotate-highlight][data-annotate-fragment="middle"] { --annotate-highlight-radius: 0; }
[data-annotate-highlight][data-annotate-fragment="end"] { --annotate-highlight-radius: 0 0.2em 0.2em 0; }
[data-annotate-highlight] { padding: 0 !important; margin: 0 !important; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
`;
  return settings.colors
    .flatMap((color) => {
      const selector = `[data-annotate-highlight="${color.id}"]`;
      return [
        `${selector} { ${highlightStyle(color.value, settings.shape).replaceAll(';', ' !important;')} }`,
        `.theme-dark ${selector} { ${highlightStyle(color.value, settings.shape, 'dark').replaceAll(';', ' !important;')} }`,
      ];
    })
    .concat(
      textColors.map(
        (color) => `[data-annotate-color="${color.id}"] { color: ${color.value} !important; }`,
      ),
    )
    .concat(fragments)
    .join('\n');
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
  const syntax: { from: number; to: number }[] = [];
  const formatting: { from: number; to: number; style: string }[] = [];
  let invalid = false;
  markdown.parse(source).iterate({
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) {
        if (node.from < to && node.to > from) invalid = true;
        return false;
      }
      const style =
        node.name === 'StrongEmphasis'
          ? 'font-weight: var(--bold-weight, 700);'
          : node.name === 'Emphasis'
            ? 'font-style: italic;'
            : node.name === 'Strikethrough'
              ? 'text-decoration: line-through;'
              : '';
      if (style) formatting.push({ from: node.from, to: node.to, style });
      if (
        ['EmphasisMark', 'StrikethroughMark', 'LinkMark', 'HTMLTag'].includes(node.name) ||
        (['URL', 'LinkTitle', 'LinkLabel'].includes(node.name) && node.node.parent?.name === 'Link')
      )
        syntax.push({ from: node.from, to: node.to });
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
    const protectedRanges: { from: number; to: number }[] = [];
    const styles: { from: number; to: number; style: string }[] = [];
    const append = (from: number, to: number) => {
      for (const range of syntax) {
        const start = Math.max(from, range.from),
          end = Math.min(to, range.to);
        if (start < end)
          protectedRanges.push({ from: text.length + start - from, to: text.length + end - from });
      }
      for (const range of formatting) {
        const start = Math.max(from, range.from),
          end = Math.min(to, range.to);
        if (start < end)
          styles.push({
            from: text.length + start - from,
            to: text.length + end - from,
            style: range.style,
          });
      }
      text += source.slice(from, to);
    };
    for (const mark of overlaps) {
      for (const [x, y] of [
        [mark.from, mark.start],
        [mark.end, mark.to],
      ]) {
        if (x === undefined || y === undefined || y <= cursor || x >= b) continue;
        append(cursor, Math.max(cursor, x));
        cursor = Math.min(b, y);
      }
    }
    append(cursor, b);
    return { text, protectedRanges, styles };
  };
  const close = `</${tag}>`;
  const wrap = ({ text, protectedRanges, styles }: ReturnType<typeof strip>, opener: string) => {
    const fragment = (from: number, to: number, lineFrom: number, lineTo: number) => {
      // Live Preview renders inline HTML as a widget, outside Markdown's font styling.
      const style = styles
        .filter((range) => range.from <= from && range.to >= to)
        .map((range) => range.style)
        .join(' ');
      let styled = opener;
      if (style) {
        const attribute = /\sstyle\s*=\s*(["'])(.*?)\1/i.exec(opener);
        if (attribute) {
          const current = (attribute[2] ?? '').trim().replace(/;+$/, '');
          if (!(attribute[2] ?? '').includes(style))
            styled = opener.replace(
              attribute[0],
              ` style=${attribute[1]}${current}; ${style}${attribute[1]}`,
            );
        } else styled = opener.slice(0, -1) + ` style="${style}">`;
      }
      if (tag === 'mark') {
        const inherited = /\sdata-annotate-fragment="(start|middle|end)"/.exec(styled)?.[1];
        const hasText = (from: number, to: number) => {
          let cursor = from;
          for (const range of protectedRanges) {
            if (range.to <= cursor || range.from >= to) continue;
            if (range.from > cursor) return true;
            cursor = range.to;
          }
          return cursor < to;
        };
        const start = !hasText(lineFrom, from) && inherited !== 'middle' && inherited !== 'end';
        const end = !hasText(to, lineTo) && inherited !== 'middle' && inherited !== 'start';
        styled = styled.replace(/\sdata-annotate-fragment="(?:start|middle|end)"/g, '');
        if (!start || !end)
          styled =
            styled.slice(0, -1) +
            ` data-annotate-fragment="${start ? 'start' : end ? 'end' : 'middle'}">`;
      }
      return `${styled}${text.slice(from, to)}${close}`;
    };
    let offset = 0;
    return text
      .split('\n')
      .map((line) => {
        const lineFrom = offset;
        offset += line.length + 1;
        // Keep block syntax outside inline HTML so headings and lists still render.
        const match = /^(\s*(?:(?:>\s*)+)?(?:(?:#{1,6}|[-+*]|\d+[.)])\s+)?)(.*?)(\s*)$/.exec(line);
        if (!match) return line;
        // Rewrapping a saved tag must retain its painted boundary spaces.
        const rewrapping = overlaps.some((mark) => mark.from === from && mark.to === to);
        if (!match[2] && !rewrapping) return line;
        const leading = rewrapping ? '' : (match[1] ?? '');
        const trailing = rewrapping ? '' : (match[3] ?? '');
        const fromOffset = lineFrom + leading.length,
          toOffset = lineFrom + line.length - trailing.length;
        let body = '',
          cursor = fromOffset;
        // Formatting delimiters stay outside HTML, including when a selection crosses them.
        for (const range of protectedRanges) {
          if (range.to <= cursor || range.from >= toOffset) continue;
          const start = Math.max(cursor, range.from),
            end = Math.min(toOffset, range.to);
          if (cursor < start) body += fragment(cursor, start, fromOffset, toOffset);
          body += text.slice(start, end);
          cursor = end;
        }
        if (cursor < toOffset) body += fragment(cursor, toOffset, fromOffset, toOffset);
        return `${leading}${body}${trailing}`;
      })
      .join('\n');
  };
  const before = strip(start, from),
    after = strip(to, end),
    selected = strip(from, to);
  const prefix =
    before.text && first && from > first.start ? wrap(before, first.open) : before.text;
  const suffix = after.text && last && to < last.end ? wrap(after, last.open) : after.text;
  const middle = open ? wrap(selected, open) : selected.text;
  const insert = prefix + middle + suffix;
  const selectedOffset = middle.indexOf(selected.text);
  const leading = open ? (/^<(?:mark|span)\b[^>]*>/.exec(middle)?.[0].length ?? 0) : 0,
    trailing = middle.endsWith(close) ? close.length : 0;
  return {
    from: start,
    to: end,
    insert,
    selectionFrom: start + prefix.length + (selectedOffset >= 0 ? selectedOffset : leading),
    selectionTo:
      start +
      prefix.length +
      (selectedOffset >= 0 ? selectedOffset + selected.text.length : middle.length - trailing),
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
): {
  from: number;
  to: number;
  tagFrom: number;
  tagTo: number;
  id: string;
  fragment: string | null;
}[] {
  const attribute = tag === 'mark' ? 'data-annotate-highlight' : 'data-annotate-color';
  const idPattern = new RegExp(`\\b${attribute}=["']([a-z][a-z0-9-]*)["']`, 'i');
  const ranges: {
    from: number;
    to: number;
    tagFrom: number;
    tagTo: number;
    id: string;
    fragment: string | null;
  }[] = [];
  const stack: { from: number; tagFrom: number; id: string; fragment: string | null }[] = [];
  markdown.parse(source).iterate({
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) return false;
      if (node.name !== 'HTMLTag') return;
      const text = source.slice(node.from, node.to);
      if (opens(tag).test(text)) {
        const id = idPattern.exec(text)?.[1] ?? '';
        stack.push({
          from: node.to,
          tagFrom: node.from,
          id,
          fragment: /\bdata-annotate-fragment="(start|middle|end)"/.exec(text)?.[1] ?? null,
        });
      } else if (closes(tag).test(text)) {
        const start = stack.pop();
        if (start?.id && node.from > start.from)
          ranges.push({
            from: start.from,
            to: node.from,
            tagFrom: start.tagFrom,
            tagTo: node.to,
            id: start.id,
            fragment: start.fragment,
          });
      }
    },
  });
  return ranges;
}

/** Inline HTML widgets hide decorations inside them, including comment count widgets. */
export function outsideInlineTags(
  position: number,
  ranges: ReturnType<typeof noteHighlights>,
): number {
  return ranges.reduce(
    (end, range) =>
      range.tagFrom < position && position < range.tagTo ? Math.max(end, range.tagTo) : end,
    position,
  );
}

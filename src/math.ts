import { parser } from '@lezer/markdown';

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'math'; text: string; source: string; display: boolean };
const escaped = (text: string, index: number): boolean => {
  let slashes = 0;
  while (index > 0 && text[--index] === '\\') slashes++;
  return slashes % 2 === 1;
};

export function mathParts(text: string): Part[] {
  const parts: Part[] = [];
  const code: { from: number; to: number }[] = [];
  parser.parse(text).iterate({
    enter(node) {
      if (['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) {
        code.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  let codeIndex = 0;
  let plain = 0,
    i = 0;
  while (i < text.length) {
    let block = code[codeIndex];
    while (block && block.to <= i) block = code[++codeIndex];
    if (block && i >= block.from) {
      i = block.to;
      continue;
    }
    if (escaped(text, i)) {
      i++;
      continue;
    }
    if (text[i] === '`') {
      const run = text.slice(i).match(/^`+/)?.[0] ?? '`';
      const end = text.indexOf(run, i + run.length);
      i = end < 0 ? text.length : end + run.length;
      continue;
    }
    const open = text.startsWith('$$', i)
      ? '$$'
      : text.startsWith('\\[', i)
        ? '\\['
        : text.startsWith('\\(', i)
          ? '\\('
          : text[i] === '$'
            ? '$'
            : null;
    if (!open) {
      i++;
      continue;
    }
    const close = open === '\\[' ? '\\]' : open === '\\(' ? '\\)' : open;
    const start = i + open.length;
    if (open === '$' && (/\s/.test(text[start] ?? '') || !text[start])) {
      i++;
      continue;
    }
    let end = text.indexOf(close, start);
    while (
      end >= 0 &&
      (escaped(text, end) ||
        (open === '$' &&
          (text[end + 1] === '$' ||
            /\s/.test(text[end - 1] ?? '') ||
            /\d/.test(text[end + 1] ?? ''))))
    )
      end = text.indexOf(close, end + close.length);
    if (
      end < 0 ||
      (open === '$' && text.slice(start, end).includes('\n')) ||
      !text.slice(start, end).trim()
    ) {
      i += open.length;
      continue;
    }
    if (i > plain) parts.push({ kind: 'text', text: text.slice(plain, i) });
    parts.push({
      kind: 'math',
      text: text.slice(i, end + close.length),
      source: text.slice(start, end),
      display: open === '$$' || open === '\\[',
    });
    i = plain = end + close.length;
  }
  if (plain < text.length) parts.push({ kind: 'text', text: text.slice(plain) });
  return parts;
}

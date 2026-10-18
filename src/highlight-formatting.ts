import { ChangeSet, EditorState } from '@codemirror/state';
import { highlightChanges, noteHighlights, wrapEdit } from './highlight';

/** Keep native Markdown formatting outside inline HTML widgets, in the same undo step. */
export const highlightFormatting = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return transaction;
  let doc = transaction.newDoc;
  let changes = ChangeSet.empty(doc.length);
  const lines: { from: number; to: number }[] = [];
  transaction.changes.iterChangedRanges((_from, _to, from, to) => {
    lines.push({ from: doc.lineAt(from).from, to: doc.lineAt(to).to });
  });
  for (const tag of ['mark', 'span'] as const) {
    const source = doc.toString();
    const candidates = noteHighlights(source, tag)
      .filter((range) => lines.some((line) => range.tagFrom <= line.to && range.tagTo >= line.from))
      .sort((a, b) => b.tagFrom - a.tagFrom);
    for (const range of candidates) {
      const current = doc.toString();
      // These styles are derived from Markdown, so toggling emphasis must recompute them.
      const open = current
        .slice(range.tagFrom, range.from)
        .replace(/\bstyle=(['"])(.*?)\1/i, (_attribute: string, quote: string, style: string) => {
          const declarations = style
            .split(';')
            .map((value) => value.trim())
            .filter(Boolean);
          const kept = declarations.filter(
            (value) =>
              !/^(?:font-weight:\s*var\(--bold-weight,\s*700\)|font-style:\s*italic|text-decoration:\s*line-through)$/.test(
                value,
              ),
          );
          return `style=${quote}${kept.join('; ')};${quote}`;
        });
      const edit = wrapEdit(current, range.tagFrom, range.tagTo, open, tag);
      if (!edit || edit.insert === current.slice(edit.from, edit.to)) continue;
      const next = highlightChanges(current, edit, tag);
      doc = next.apply(doc);
      changes = changes.compose(next);
      for (const line of lines) {
        line.from = next.mapPos(line.from, -1);
        line.to = next.mapPos(line.to, 1);
      }
    }
  }
  return changes.empty ? transaction : [transaction, { changes, sequential: true }];
});

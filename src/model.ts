import { z } from 'zod';
import { providerSchema } from './ai';
import { highlightSettingsSchema, defaultHighlights } from './highlight';
import { agentSettingsSchema, emptyAgentSettings } from './agent-settings';
import type { ChangeDesc } from '@codemirror/state';
const anchorSchema = z
  .object({
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
    quote: z.string().min(1),
    prefix: z.string(),
    suffix: z.string(),
    orphaned: z.boolean(),
  })
  .refine((a) => a.to > a.from, 'Invalid text range');
export const replyQuoteSchema = z.object({
  messageId: z.string().min(1),
  text: z.string().min(1),
});
export type ReplyQuote = z.infer<typeof replyQuoteSchema>;
const commentSchema = z
  .object({
    id: z.string().min(1),
    author: z.string(),
    body: z.string(),
    quote: replyQuoteSchema.optional(),
    role: z.enum(['user', 'assistant']).optional(),
    provider: providerSchema.optional(),
    status: z
      .enum(['pending', 'streaming', 'completed', 'cancelled', 'failed', 'unknown'])
      .optional(),
    createdAt: z.number().int().nonnegative().max(8.64e15),
  })
  .refine(
    (c) => c.body.length > 0 || c.role === 'assistant',
    'Empty comments are only allowed for assistant responses',
  );
const threadSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  anchor: anchorSchema,
  comments: z.array(commentSchema).min(1),
  resolved: z.boolean(),
  codex: z
    .object({
      sessionId: z.string().optional(),
      provider: providerSchema.optional(),
      contextVersion: z.literal(2).optional(),
      historyDirty: z.boolean().optional(),
      status: z.enum([
        'idle',
        'pending',
        'streaming',
        'completed',
        'cancelled',
        'failed',
        'unknown',
        'unavailable',
      ]),
      error: z.string().optional(),
      turnMessageId: z.string().optional(),
    })
    .optional(),
});
/** Short aliases saved by older settings, mapped to the full model name they meant. */
const claudeAliases: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};
export const dataSchema = z.object({
  version: z.literal(1),
  author: z.string(),
  highlights: highlightSettingsSchema.default(defaultHighlights),
  threads: z.array(threadSchema),
  agent: agentSettingsSchema.prefault({}),
  assistant: z
    .object({
      provider: providerSchema.default('chatgpt'),
      claude: z
        .object({
          executable: z.string(),
          model: z.string().transform((model) => claudeAliases[model] ?? model),
        })
        .default({ executable: 'claude', model: 'claude-sonnet-5-5' }),
    })
    .default({
      provider: 'chatgpt',
      claude: { executable: 'claude', model: 'claude-sonnet-5-5' },
    }),
  codex: z
    .object({
      enabled: z.boolean().default(false),
      executable: z.string().default('codex'),
      model: z.string().default(''),
    })
    .default({ enabled: false, executable: 'codex', model: '' }),
});
export type Anchor = z.infer<typeof anchorSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type PluginData = z.infer<typeof dataSchema>;
export const emptyData = (): PluginData => ({
  version: 1,
  author: 'You',
  highlights: defaultHighlights(),
  threads: [],
  agent: emptyAgentSettings(),
  codex: { enabled: false, executable: 'codex', model: '' },
  assistant: {
    provider: 'chatgpt',
    claude: { executable: 'claude', model: 'claude-sonnet-5-5' },
  },
});
export function makeAnchor(text: string, from: number, to: number): Anchor {
  if (from < 0 || to > text.length || to <= from) throw new Error('Select a text range first.');
  return {
    from,
    to,
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - 40), from),
    suffix: text.slice(to, to + 40),
    orphaned: false,
  };
}
export function locateAnchor(anchor: Anchor, text: string): Anchor {
  if (anchor.orphaned) return anchor;
  const hits: number[] = [];
  let offset = text.indexOf(anchor.quote);
  while (offset >= 0) {
    hits.push(offset);
    offset = text.indexOf(anchor.quote, offset + 1);
  }
  if (hits.length === 1) {
    const from = hits[0];
    if (from !== undefined) return makeAnchor(text, from, from + anchor.quote.length);
  }
  const contextual = hits.filter(
    (from) =>
      text.slice(Math.max(0, from - anchor.prefix.length), from) === anchor.prefix &&
      text.slice(from + anchor.quote.length, from + anchor.quote.length + anchor.suffix.length) ===
        anchor.suffix,
  );
  const from = contextual[0];
  if (contextual.length === 1 && from !== undefined)
    return makeAnchor(text, from, from + anchor.quote.length);
  return { ...anchor, orphaned: true };
}
export function mapAnchor(anchor: Anchor, changes: ChangeDesc, newText: string): Anchor {
  if (anchor.orphaned) return anchor;
  const from = changes.mapPos(anchor.from, 1),
    to = changes.mapPos(anchor.to, -1);
  if (to <= from) return { ...anchor, orphaned: true };
  return makeAnchor(newText, from, to);
}
export function renameThreads(threads: Thread[], oldPath: string, newPath: string): void {
  for (const thread of threads) {
    if (thread.path === oldPath || thread.path.startsWith(oldPath + '/'))
      thread.path = newPath + thread.path.slice(oldPath.length);
  }
}

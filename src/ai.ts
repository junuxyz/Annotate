import { z } from 'zod';
import { CodexBackend, type ConnectionState, type ResponseState } from './codex';
import { ClaudeBackend } from './claude';

export const providerSchema = z.enum(['chatgpt', 'claude']);
export type ProviderId = z.infer<typeof providerSchema>;
export const providers = {
  chatgpt: { name: 'ChatGPT', executable: 'codex', model: '' },
  claude: { name: 'Claude', executable: 'claude', model: 'claude-sonnet-5-5' },
} satisfies Record<ProviderId, { name: string; executable?: string; model: string }>;

/** Finds a CLI that Obsidian's GUI PATH misses, so bare names like `claude` work without setup. */
export function resolveExecutable(executable: string): string {
  if (!executable || executable.includes('/') || executable.includes('\\')) return executable;
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const os = require('node:os') as typeof import('node:os');
    const path = require('node:path') as typeof import('node:path');
    const home = os.homedir();
    const directories = [
      ...(process.env.PATH ?? '').split(path.delimiter),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'local'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.volta', 'bin'),
    ];
    for (const directory of directories) {
      if (!directory) continue;
      const candidate = path.join(directory, executable);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Try the next directory.
      }
    }
  } catch {
    // Not running under Node; keep the configured name.
  }
  return executable;
}

/** Claude models offered in settings, most capable first, keyed by full model name. */
export const claudeModels: Record<string, string> = {
  'claude-fable-5-1': 'Fable 5.1',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
};

/** ChatGPT models Codex last cached for this account, so settings can list them before a check. */
export function cachedChatgptModels(): Record<string, string> {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const os = require('node:os') as typeof import('node:os');
    const path = require('node:path') as typeof import('node:path');
    const cache = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8'),
    ) as { models?: { slug?: unknown; display_name?: unknown }[] };
    const models: Record<string, string> = {};
    for (const m of cache.models ?? [])
      if (typeof m.slug === 'string')
        models[m.slug] = typeof m.display_name === 'string' ? m.display_name : m.slug;
    return models;
  } catch {
    return {};
  }
}

export interface AssistantBackend {
  state: ConnectionState;
  models?: Record<string, string>;
  detail: string;
  model: string | null;
  readonly retainsHistory?: boolean;
  enable(): Promise<void>;
  connect(): Promise<void>;
  session(id?: string): Promise<string>;
  ask(
    id: string,
    text: string,
    delta: (text: string) => void,
    finish: (state: ResponseState, error?: string) => void,
  ): Promise<void>;
  interrupt(id: string): Promise<void>;
  disable(): void;
}

type AssistantConfig =
  | { provider: 'chatgpt'; executable: string; model?: string }
  | { provider: 'claude'; executable: string; model: string };

export function createAssistant(config: AssistantConfig, update: () => void): AssistantBackend {
  switch (config.provider) {
    case 'chatgpt': {
      const backend = new CodexBackend(resolveExecutable(config.executable), update);
      backend.preferredModel = config.model ?? '';
      return backend;
    }
    case 'claude':
      return new ClaudeBackend(resolveExecutable(config.executable), config.model, update);
  }
}

export function assistantInvocation(
  body: string,
): { provider: ProviderId; question: string } | null {
  const matches = [...body.matchAll(/(^|\s)@(chatgpt|claude)\b/gi)];
  if (!matches.length) return null;
  const provider = providerSchema.parse(matches[0]?.[2]?.toLowerCase());
  if (matches.some((match) => match[2]?.toLowerCase() !== provider))
    throw new Error('Ask one assistant at a time.');
  return { provider, question: body.replace(/(^|\s)@(chatgpt|claude)\b/gi, '$1').trim() };
}

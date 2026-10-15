import { FileSystemAdapter, TFile, type FileManager, type Vault } from 'obsidian';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const MAX_NOTE_LENGTH = 1_000_000;
const content = z.string().max(MAX_NOTE_LENGTH);
const schemas = {
  search_notes: z.object({ query: z.string().min(1).max(500) }).strict(),
  read_note: z.object({ path: z.string() }).strict(),
  create_note: z.object({ path: z.string(), content }).strict(),
  edit_note: z.object({ path: z.string(), content, expectedContent: content }).strict(),
  delete_note: z.object({ path: z.string(), expectedContent: content }).strict(),
  request_note_folder: z.object({ folder: z.string() }).strict(),
};
const descriptions: Record<keyof typeof schemas, string> = {
  search_notes:
    'Search Markdown note contents inside approved folders. Returns at most 50 matching paths.',
  read_note: 'Read a Markdown note inside an approved folder.',
  create_note:
    'Create a Markdown note inside an approved, existing folder, with a recoverable snapshot.',
  edit_note:
    'Replace a Markdown note only if its content still matches expectedContent. Saves a recoverable snapshot.',
  delete_note:
    'Move a Markdown note to Obsidian trash only if its content matches expectedContent. Saves a recoverable snapshot.',
  request_note_folder: 'Ask the user to approve access to one specific existing note folder.',
};
export const NOTE_TOOL_DEFINITIONS = Object.entries(schemas).map(([name, schema]) => ({
  name,
  description: descriptions[name as keyof typeof schemas],
  inputSchema: z.toJSONSchema(schema),
}));

const changeSchema = z.object({
  path: z.string(),
  before: content.nullable(),
  after: content.nullable(),
});
export const noteHistorySchema = z.array(
  z.object({
    id: z.string(),
    createdAt: z.number(),
    status: z.enum(['pending', 'complete', 'undone']),
    changes: z.array(changeSchema),
  }),
);
export type NoteOperation = z.infer<typeof noteHistorySchema>[number];

/** Literal vault-relative paths only. A folder grant of '.' explicitly selects the vault root. */
export function normalizeNoteFolder(value: string, configDir = '.obsidian'): string {
  if (value === '.') return '.';
  if (
    !value ||
    value !== value.trim() ||
    /[\\:%]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('Use a literal vault-relative folder path.');
  const parts = value.split('/');
  if (
    parts.some(
      (part) =>
        !part || part === '..' || part.startsWith('.') || part.endsWith('.') || part.endsWith(' '),
    )
  )
    throw new Error('Hidden folders, traversal, and ambiguous paths are unavailable.');
  const first = parts[0];
  if (first?.toLocaleLowerCase() === configDir.split('/')[0]?.toLocaleLowerCase())
    throw new Error('Obsidian configuration is unavailable.');
  return parts.join('/');
}

interface NoteToolsOptions {
  vault: Vault;
  fileManager: Pick<FileManager, 'trashFile'>;
  getFolders: () => string[];
  requestFolderAccess: (folder: string, signal?: AbortSignal) => Promise<boolean>;
  /** Persist in plugin-private data, never in an agent-readable note folder. */
  saveHistory: (history: NoteOperation[]) => Promise<void>;
  history?: NoteOperation[];
}

export class NoteTools {
  private records: NoteOperation[];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: NoteToolsOptions) {
    this.records = noteHistorySchema.parse(options.history ?? []);
  }
  get history(): NoteOperation[] {
    return structuredClone(this.records);
  }
  private async persist(records: NoteOperation[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (JSON.stringify(records).length > 20_000_000)
      throw new Error(
        'Operation snapshots are full. Further note changes are blocked to preserve recovery history.',
      );
    await this.options.saveHistory(structuredClone(records));
    this.records = structuredClone(records);
    signal?.throwIfAborted();
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  private async verifyPhysicalPath(path: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const adapter = this.options.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter))
      throw new Error('Bounded note tools require a local filesystem vault.');
    let current = adapter.getBasePath();
    // Metadata only. All note contents and changes use the Obsidian APIs.
    for (const segment of path.split('/')) {
      current = join(current, segment);
      try {
        const stat = await lstat(current);
        signal?.throwIfAborted();
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
          throw new Error('Symbolic links and hard links are unavailable to note tools.');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      }
    }
  }
  async assertAllowed(path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const normalized = normalizeNoteFolder(path, this.options.vault.configDir);
    if (!normalized.toLowerCase().endsWith('.md'))
      throw new Error('Only Markdown notes are available.');
    const allowed = this.options.getFolders().some((folder) => {
      try {
        const safe = normalizeNoteFolder(folder, this.options.vault.configDir);
        return safe === '.' || normalized.startsWith(`${safe}/`);
      } catch {
        return false;
      }
    });
    if (!allowed)
      throw new Error(
        'This note is outside the approved folders. Request access to its folder first.',
      );
    await this.verifyPhysicalPath(normalized, signal);
    signal?.throwIfAborted();
    return normalized;
  }
  private file(path: string): TFile {
    const file = this.options.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('Note does not exist.');
    if (file.stat.size > MAX_NOTE_LENGTH * 4) throw new Error('Note is too large.');
    return file;
  }
  private async read(path: string, signal?: AbortSignal): Promise<string> {
    await this.assertAllowed(path, signal);
    signal?.throwIfAborted();
    const text = await this.options.vault.read(this.file(path));
    signal?.throwIfAborted();
    return content.parse(text);
  }
  private async change(
    path: string,
    before: string | null,
    after: string | null,
    id: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!id || id.length > 200) throw new Error('A valid operation id is required.');
    await this.assertAllowed(path, signal);
    const existing = this.records.find((record) => record.id === id);
    if (existing?.status === 'pending')
      throw new Error('Resolve the unfinished operation before making further changes.');
    if (!existing && this.records.length >= 1000)
      throw new Error(
        'Operation history is full. Further note changes are blocked to preserve recovery snapshots.',
      );
    const current = this.options.vault.getAbstractFileByPath(path)
      ? await this.read(path, signal)
      : null;
    if (current !== before) throw new Error('Note changed. Read it again before making changes.');
    if (existing?.status === 'undone') throw new Error('This operation was already undone.');
    const record: NoteOperation = existing
      ? structuredClone(existing)
      : { id, createdAt: Date.now(), status: 'pending', changes: [] };
    record.changes.push({ path, before, after });
    record.status = 'pending';
    await this.persist([...this.records.filter((entry) => entry.id !== id), record], signal);
    await this.write(path, before, after, signal);
    record.status = 'complete';
    await this.persist([...this.records.filter((entry) => entry.id !== id), record], signal);
  }
  private async write(
    path: string,
    before: string | null,
    after: string | null,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.assertAllowed(path, signal);
    signal?.throwIfAborted();
    if (before === null) {
      if (this.options.vault.getAbstractFileByPath(path)) throw new Error('Note already exists.');
      if (after !== null) await this.options.vault.create(path, after);
    } else if (after === null) {
      if ((await this.read(path, signal)) !== before)
        throw new Error('Note changed. Read it again before deleting.');
      signal?.throwIfAborted();
      await this.options.fileManager.trashFile(this.file(path));
    } else {
      await this.options.vault.process(this.file(path), (current) => {
        signal?.throwIfAborted();
        if (current !== before) throw new Error('Note changed. Read it again before editing.');
        return after;
      });
    }
  }
  execute(
    name: string,
    args: unknown,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.serialized(async () => {
      signal?.throwIfAborted();
      switch (name) {
        case 'read_note': {
          const { path } = schemas.read_note.parse(args);
          return { path, content: await this.read(path, signal) };
        }
        case 'search_notes': {
          const { query } = schemas.search_notes.parse(args);
          const matches: string[] = [];
          for (const file of this.options.vault.getMarkdownFiles()) {
            try {
              await this.assertAllowed(file.path, signal);
            } catch {
              signal?.throwIfAborted();
              continue;
            }
            if (
              (await this.read(file.path, signal))
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase())
            )
              matches.push(file.path);
            if (matches.length >= 50) break;
          }
          return { paths: matches };
        }
        case 'request_note_folder': {
          const { folder } = schemas.request_note_folder.parse(args);
          const safe = normalizeNoteFolder(folder, this.options.vault.configDir);
          await this.verifyPhysicalPath(safe, signal);
          signal?.throwIfAborted();
          const entry =
            safe === '.'
              ? this.options.vault.getRoot()
              : this.options.vault.getAbstractFileByPath(safe);
          if (!entry || entry instanceof TFile) throw new Error('Choose an existing folder.');
          const approved = await this.options.requestFolderAccess(safe, signal);
          signal?.throwIfAborted();
          return { folder: safe, approved };
        }
        case 'create_note': {
          const { path, content: text } = schemas.create_note.parse(args);
          await this.change(path, null, text, operationId, signal);
          return { path, saved: true };
        }
        case 'edit_note': {
          const { path, content: text, expectedContent } = schemas.edit_note.parse(args);
          await this.change(path, expectedContent, text, operationId, signal);
          return { path, saved: true };
        }
        case 'delete_note': {
          const { path, expectedContent } = schemas.delete_note.parse(args);
          await this.change(path, expectedContent, null, operationId, signal);
          return { path, trashed: true };
        }
        default:
          throw new Error('Unknown note tool.');
      }
    });
  }
  undo(operationId: string, signal?: AbortSignal): Promise<void> {
    return this.serialized(async () => {
      signal?.throwIfAborted();
      const record = this.records.find((entry) => entry.id === operationId);
      if (!record || record.status === 'undone') throw new Error('Operation is unavailable.');
      const paths = new Map<
        string,
        { before: string | null; after: string | null; previous: string | null }
      >();
      for (const change of record.changes) {
        const first = paths.get(change.path);
        paths.set(change.path, {
          before: first ? first.before : change.before,
          after: change.after,
          previous: change.before,
        });
      }
      // Preflight every note before changing any note in this operation. A pending
      // write may have failed before applying its final snapshot.
      const currentByPath = new Map<string, string | null>();
      for (const [path, change] of paths) {
        await this.assertAllowed(path, signal);
        const current = this.options.vault.getAbstractFileByPath(path)
          ? await this.read(path, signal)
          : null;
        if (
          current !== change.after &&
          current !== change.before &&
          !(record.status === 'pending' && current === change.previous)
        )
          throw new Error(`Cannot undo: ${path} changed. Its snapshot is preserved.`);
        currentByPath.set(path, current);
      }
      for (const [path, change] of [...paths].reverse()) {
        const current = currentByPath.get(path);
        if (current !== undefined && current !== change.before)
          await this.write(path, current, change.before, signal);
      }
      await this.persist(
        this.records.map((entry) =>
          entry.id === operationId ? { ...entry, status: 'undone' } : entry,
        ),
        signal,
      );
    });
  }
}

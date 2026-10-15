import type { DataAdapter } from 'obsidian';
import { z } from 'zod';
import { noteHistorySchema, type NoteOperation } from './note-tools';

const filenamePattern =
  /^\d{16}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
const snapshotSchema = z
  .object({
    format: z.literal(1),
    parent: z.string().regex(filenamePattern).nullable(),
    records: noteHistorySchema,
  })
  .strict();
const guidance =
  'Assistant history changed or is damaged. Note changes are blocked. Preserve every agent-history file, resolve conflicting snapshots from backups, then reload Annotate.';
type Observed = { files: string[]; tip: string | null; fingerprints: Map<string, string> };

function fingerprints(records: NoteOperation[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const record of records) {
    if (result.has(record.id)) throw new Error('Duplicate operation identifier.');
    result.set(record.id, JSON.stringify(record));
  }
  return result;
}

/** Immutable snapshots retain every branch so sync conflicts cannot erase recovery data. */
export class OperationHistoryStore {
  private observed: Observed | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly options: {
      adapter: Pick<DataAdapter, 'exists' | 'list' | 'read' | 'write' | 'mkdir'>;
      directory: string;
    },
  ) {}
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  private async files(): Promise<string[]> {
    const { adapter, directory } = this.options;
    if (!(await adapter.exists(directory))) return [];
    const prefix = `${directory}/`;
    return (await adapter.list(directory)).files
      .filter((path) => path.startsWith(prefix) && filenamePattern.test(path.slice(prefix.length)))
      .map((path) => path.slice(prefix.length))
      .sort();
  }
  private sameFiles(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((file, index) => file === right[index]);
  }
  load(): Promise<NoteOperation[]> {
    return this.serialized(async () => {
      this.observed = null;
      try {
        const files = await this.files();
        const snapshots = new Map<string, z.infer<typeof snapshotSchema>>();
        for (const name of files) {
          const raw: unknown = JSON.parse(
            await this.options.adapter.read(`${this.options.directory}/${name}`),
          );
          snapshots.set(name, snapshotSchema.parse(raw));
        }
        const children = new Map<string, string>();
        let root: string | null = null;
        for (const [name, snapshot] of snapshots) {
          if (snapshot.parent === null) {
            if (root !== null) throw new Error('Multiple history roots.');
            root = name;
          } else {
            if (!snapshots.has(snapshot.parent) || children.has(snapshot.parent))
              throw new Error('Missing parent or conflicting history branches.');
            children.set(snapshot.parent, name);
          }
        }
        let tip = root;
        const visited = new Set<string>();
        const operations = new Map<string, NoteOperation>();
        while (tip !== null) {
          if (visited.has(tip)) throw new Error('History ancestry contains a cycle.');
          visited.add(tip);
          const snapshot = snapshots.get(tip);
          if (!snapshot) throw new Error('History snapshot is missing.');
          fingerprints(snapshot.records);
          // Each snapshot contains only changed operations, in their current form.
          for (const record of snapshot.records) {
            operations.delete(record.id);
            operations.set(record.id, record);
          }
          const child = children.get(tip);
          if (!child) break;
          tip = child;
        }
        if (visited.size !== files.length) throw new Error('History ancestry is incomplete.');
        if (!this.sameFiles(files, await this.files()))
          throw new Error('History changed during load.');
        const records = [...operations.values()];
        this.observed = { files, tip, fingerprints: fingerprints(records) };
        return structuredClone(records);
      } catch (error) {
        throw new Error(guidance, { cause: error });
      }
    });
  }
  save(records: NoteOperation[]): Promise<void> {
    // Snapshot the caller's input before waiting for another save.
    const parsed = structuredClone(noteHistorySchema.parse(records));
    return this.serialized(async () => {
      const previous = this.observed;
      if (!previous) throw new Error(guidance);
      try {
        if (!this.sameFiles(previous.files, await this.files()))
          throw new Error('History changed before save.');
        const currentFingerprints = fingerprints(parsed);
        if ([...previous.fingerprints.keys()].some((id) => !currentFingerprints.has(id)))
          throw new Error('Operation history cannot discard saved operations.');
        const changed = parsed.filter(
          (record) => previous.fingerprints.get(record.id) !== currentFingerprints.get(record.id),
        );
        if (!changed.length) return;
        const { adapter, directory } = this.options;
        if (!(await adapter.exists(directory))) await adapter.mkdir(directory);
        const timestamp = Math.max(Date.now(), Number(previous.tip?.slice(0, 16) ?? 0) + 1);
        const name = `${String(timestamp).padStart(16, '0')}-${crypto.randomUUID()}.json`;
        await adapter.write(
          `${directory}/${name}`,
          JSON.stringify({ format: 1, parent: previous.tip, records: changed }),
        );
        const expected = [...previous.files, name].sort();
        if (!this.sameFiles(expected, await this.files()))
          throw new Error('Concurrent history snapshot detected.');
        this.observed = { files: expected, tip: name, fingerprints: currentFingerprints };
      } catch (error) {
        this.observed = null;
        throw new Error(guidance, { cause: error });
      }
    });
  }
}

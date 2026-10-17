import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  FileSystemAdapter,
  MarkdownView,
  Modal,
  Notice,
  Setting,
  TFolder,
  type App,
} from 'obsidian';
import { z } from 'zod';
import type { HostTool } from './codex';
import { McpServices, mcpServiceSchema, type McpApproval } from './mcp';
import type { AgentSettings } from './agent-settings';
import { OperationHistoryStore } from './operation-history';
import { NoteTools, NOTE_TOOL_DEFINITIONS, normalizeNoteFolder } from './note-tools';

class AccessPrompt extends Modal {
  private accepted = false;
  constructor(
    app: App,
    private readonly request: { title: string; detail: string; preview?: string; allow: string },
    private readonly finish: (accepted: boolean) => void,
  ) {
    super(app);
  }
  onOpen(): void {
    this.modalEl.addClass('annotate-access-prompt');
    this.setTitle(this.request.title);
    this.contentEl.createEl('p', { text: this.request.detail });
    if (this.request.preview)
      this.contentEl.createEl('pre', {
        text: this.request.preview,
        cls: 'annotate-access-preview',
      });
    const row = new Setting(this.contentEl);
    row.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
    row.addButton((button) =>
      button
        .setButtonText(this.request.allow)
        .setCta()
        .onClick(() => {
          this.accepted = true;
          this.close();
        }),
    );
    this.contentEl.querySelector<HTMLButtonElement>('button')?.focus();
  }
  onClose(): void {
    this.finish(this.accepted);
  }
}

type AccessOptions = {
  app: App;
  directory: () => string;
  settings: () => AgentSettings;
  save: () => Promise<void>;
  reconfigure: () => void;
};

export class AgentAccess {
  private prompts = new Set<AccessPrompt>();
  private notesPromise: Promise<NoteTools> | null = null;
  private generation = 0;
  private disposed = false;
  private readonly services: McpServices;
  constructor(private readonly options: AccessOptions) {
    this.services = new McpServices({
      services: () => this.options.settings().services,
      approve: (request) => this.approveExternal(request),
    });
  }
  private confirm(
    request: { title: string; detail: string; preview?: string; allow: string },
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (this.disposed || signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const prompt = new AccessPrompt(this.options.app, request, (accepted) => {
        this.prompts.delete(prompt);
        signal?.removeEventListener('abort', abort);
        resolve(accepted && !signal?.aborted && !this.disposed);
      });
      const abort = () => prompt.close();
      this.prompts.add(prompt);
      signal?.addEventListener('abort', abort, { once: true });
      prompt.open();
      if (signal?.aborted) prompt.close();
    });
  }
  cancelApprovals(): void {
    this.generation++;
    for (const prompt of [...this.prompts]) prompt.close();
  }
  dispose(): void {
    this.disposed = true;
    this.cancelApprovals();
  }
  private contains(folder: string): boolean {
    return this.options
      .settings()
      .folders.some(
        (allowed) => allowed === '.' || folder === allowed || folder.startsWith(`${allowed}/`),
      );
  }
  async grantFolder(folder: string, signal?: AbortSignal, context?: string): Promise<boolean> {
    const safe = normalizeNoteFolder(folder, this.options.app.vault.configDir);
    if (this.contains(safe)) return !signal?.aborted;
    const entry =
      safe === '.'
        ? this.options.app.vault.getRoot()
        : this.options.app.vault.getAbstractFileByPath(safe);
    if (!(entry instanceof TFolder)) throw new Error('Choose an existing note folder.');
    const generation = this.generation;
    const accepted = await this.confirm(
      {
        title: 'Allow assistant access to this folder?',
        detail: `The assistant may read, search, create, edit, and trash Markdown notes in ${safe === '.' ? 'the vault and its visible subfolders' : safe + ' and its subfolders'} without asking for each edit. Hidden folders and Obsidian configuration stay inaccessible. Changes have local recovery snapshots. Terminal access is unavailable.`,
        preview: context,
        allow: 'Allow folder',
      },
      signal,
    );
    if (!accepted || signal?.aborted || generation !== this.generation) return false;
    const previous = this.options.settings().folders;
    this.options.settings().folders = [...new Set([...previous, safe])];
    try {
      await this.options.save();
    } catch (error) {
      this.options.settings().folders = this.options
        .settings()
        .folders.filter((folder) => folder !== safe);
      throw error;
    }
    if (signal?.aborted || generation !== this.generation) {
      this.options.settings().folders = this.options
        .settings()
        .folders.filter((folder) => folder !== safe);
      await this.options.save();
      return false;
    }
    return true;
  }
  async ensureContext(path: string, provider: string, signal?: AbortSignal): Promise<boolean> {
    // Validate the note itself before asking for any broader folder grant.
    const safe = normalizeNoteFolder(path, this.options.app.vault.configDir);
    if (!safe.toLowerCase().endsWith('.md')) throw new Error('Only Markdown notes can be shared.');
    const folder = safe.includes('/') ? safe.slice(0, safe.lastIndexOf('/')) : '.';
    if (
      !(await this.grantFolder(
        folder,
        signal,
        `Model context for ${provider}: the complete current note ${safe}, selected passage, your question, and this thread's earlier comments and replies. Local @comment messages can enter later AI context.`,
      ))
    )
      return false;
    await (await this.notes()).assertAllowed(safe, signal);
    return !signal?.aborted;
  }
  private async notes(): Promise<NoteTools> {
    if (!this.notesPromise)
      this.notesPromise = this.loadNotes().catch((error: unknown) => {
        this.notesPromise = null;
        throw error;
      });
    return this.notesPromise;
  }
  private async loadNotes(): Promise<NoteTools> {
    const adapter = this.options.app.vault.adapter;
    const directory = `${this.options.directory()}/agent-history`;
    const store = new OperationHistoryStore({ adapter, directory });
    const history = await store.load();
    return new NoteTools({
      vault: this.options.app.vault,
      fileManager: this.options.app.fileManager,
      getEditor: (path) => {
        const workspace = this.options.app.workspace;
        const active = workspace.getActiveViewOfType(MarkdownView);
        if (active?.file?.path === path && active.getMode() !== 'preview') return active.editor;
        for (const leaf of workspace.getLeavesOfType('markdown')) {
          const view = leaf.view;
          if (
            view instanceof MarkdownView &&
            view.file?.path === path &&
            view.getMode() !== 'preview'
          )
            return view.editor;
        }
        return null;
      },
      getFolders: () => this.options.settings().folders,
      requestFolderAccess: (folder, signal) => this.grantFolder(folder, signal),
      saveHistory: (records) => store.save(records),
      history,
    });
  }
  private approveExternal(request: McpApproval): Promise<boolean> {
    return this.confirm(
      {
        title: 'Approve external service action?',
        detail: `${request.serviceName} will receive these arguments at ${request.url}. This may send messages, upload data, or publish content. Approval applies to this call only.`,
        preview: JSON.stringify({ tool: request.toolName, arguments: request.arguments }, null, 2),
        allow: 'Approve once',
      },
      request.signal,
    );
  }
  tools(): HostTool[] {
    return [
      ...NOTE_TOOL_DEFINITIONS.map((definition) => ({
        ...definition,
        execute: async (args: unknown, context: Parameters<HostTool['execute']>[1]) => {
          if (context.signal.aborted || this.disposed) throw new Error('Request cancelled.');
          return (await this.notes()).execute(
            definition.name,
            args,
            `${context.threadId}:${context.turnId}`,
            context.signal,
          );
        },
      })),
      {
        name: 'list_mcp_tools',
        description:
          'List tools of the remote services the user explicitly enabled. No note content is sent during discovery.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async (_args, context) =>
          (await this.services.tools(context.signal)).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
      },
      {
        name: 'call_mcp_tool',
        description:
          'Call a selected external service tool. The user must approve the complete arguments before anything is sent.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            arguments: { type: 'object', additionalProperties: true },
          },
          required: ['name', 'arguments'],
          additionalProperties: false,
        },
        execute: async (args, context) => {
          const call = z
            .object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) })
            .strict()
            .parse(args);
          const tool = (await this.services.tools(context.signal)).find(
            (candidate) => candidate.name === call.name,
          );
          if (!tool) throw new Error('This service tool is unavailable or disabled.');
          return tool.execute(call.arguments, context);
        },
      },
    ];
  }
  codexHome(): string {
    const adapter = this.options.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter))
      throw new Error('Assistant note tools require a local filesystem vault.');
    const key = crypto
      .createHash('sha256')
      .update(adapter.getBasePath())
      .digest('hex')
      .slice(0, 24);
    return path.join(os.homedir(), '.annotate', 'codex', key);
  }
  async showHistory(): Promise<void> {
    const notes = await this.notes();
    const modal = new Modal(this.options.app);
    modal.setTitle('Assistant change history');
    modal.modalEl.addClass('annotate-operation-history');
    const paint = () => {
      modal.contentEl.empty();
      modal.contentEl.createEl('p', {
        text: 'Snapshots stay in this vault’s private Annotate data. Undo restores an entire operation only if its notes have not changed since. Revoked folder access also prevents undo until you grant it again.',
      });
      if (!notes.history.length)
        modal.contentEl.createEl('p', { text: 'No assistant note changes yet.' });
      for (const record of [...notes.history].reverse()) {
        const row = new Setting(modal.contentEl)
          .setName(`${new Date(record.createdAt).toLocaleString()} · ${record.status}`)
          .setDesc(record.changes.map((change) => change.path).join(', '));
        row.addButton((button) =>
          button.setButtonText('View snapshots').onClick(() => {
            const preview = new Modal(this.options.app);
            preview.modalEl.addClass('annotate-operation-snapshot');
            preview.setTitle('Operation snapshots');
            preview.contentEl.createEl('pre', {
              text: JSON.stringify(record.changes, null, 2),
              cls: 'annotate-access-preview',
            });
            preview.open();
          }),
        );
        row.addButton((button) =>
          button
            .setButtonText('Undo operation')
            .setDisabled(record.status === 'undone')
            .onClick(async () => {
              button.setDisabled(true);
              try {
                await notes.undo(record.id);
                paint();
              } catch (error) {
                new Notice(
                  error instanceof Error ? error.message : 'Could not undo this operation.',
                );
                button.setDisabled(false);
              }
            }),
        );
      }
    };
    paint();
    modal.open();
  }
  renderSettings(container: HTMLElement): void {
    new Setting(container).setName('Assistant access').setHeading();
    container.createEl('p', {
      cls: 'setting-item-description',
      text: 'ChatGPT note tools may read and change notes only in approved folders. Claude receives supplied context and has no note tools. Terminal access is unavailable. Hidden folders and Obsidian configuration are excluded.',
    });
    for (const folder of this.options.settings().folders) {
      new Setting(container)
        .setName(folder === '.' ? 'Entire vault · visible Markdown notes' : folder)
        .addButton((button) =>
          button.setButtonText('Revoke').onClick(async () => {
            this.cancelApprovals();
            this.options.settings().folders = this.options
              .settings()
              .folders.filter((value) => value !== folder);
            await this.options.save();
            this.options.reconfigure();
            container.empty();
            this.renderSettings(container);
          }),
        );
    }
    let selected = '';
    new Setting(container)
      .setName('Approve a note folder')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'Choose a folder…').addOption('.', 'Entire vault');
        for (const entry of this.options.app.vault.getAllLoadedFiles()) {
          if (!(entry instanceof TFolder) || !entry.path || entry.path === '/') continue;
          try {
            normalizeNoteFolder(entry.path, this.options.app.vault.configDir);
          } catch {
            continue;
          }
          dropdown.addOption(entry.path, entry.path);
        }
        dropdown.onChange((value) => {
          selected = value;
        });
      })
      .addButton((button) =>
        button.setButtonText('Allow folder').onClick(async () => {
          if (!selected) return;
          if (await this.grantFolder(selected)) {
            container.empty();
            this.renderSettings(container);
          }
        }),
      );
    new Setting(container)
      .setName('Change history')
      .setDesc('Review snapshots and undo a complete assistant operation.')
      .addButton((button) =>
        button.setButtonText('View history').onClick(() => {
          void this.showHistory().catch((error: unknown) => new Notice(String(error)));
        }),
      );
    new Setting(container)
      .setName('Web search')
      .setDesc(
        'Off by default. When enabled, ChatGPT can send search queries derived from note context to the web search service. Command networking remains disabled.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.options.settings().webSearch).onChange(async (value) => {
          this.options.settings().webSearch = value;
          await this.options.save();
          this.options.reconfigure();
        }),
      );
    new Setting(container).setName('Selected MCP services').setHeading();
    container.createEl('p', {
      cls: 'setting-item-description',
      text: 'Add a public HTTPS MCP endpoint explicitly. No CLI services, credentials, browser cookies, or plugins are inherited. Every external tool call requires approval of its full arguments. Authenticated and local command servers are unavailable in this release.',
    });
    for (const service of this.options.settings().services) {
      new Setting(container)
        .setName(service.name)
        .setDesc(service.url)
        .addToggle((toggle) =>
          toggle.setValue(service.enabled).onChange(async (value) => {
            this.cancelApprovals();
            service.enabled = value;
            await this.options.save();
            this.options.reconfigure();
          }),
        )
        .addButton((button) =>
          button.setButtonText('Remove').onClick(async () => {
            this.cancelApprovals();
            this.options.settings().services = this.options
              .settings()
              .services.filter((entry) => entry.id !== service.id);
            await this.options.save();
            this.options.reconfigure();
            container.empty();
            this.renderSettings(container);
          }),
        );
    }
    let name = '',
      url = '';
    new Setting(container)
      .setName('Add MCP service')
      .addText((text) =>
        text.setPlaceholder('Service name').onChange((value) => {
          name = value;
        }),
      )
      .addText((text) =>
        text.setPlaceholder('Service endpoint').onChange((value) => {
          url = value;
        }),
      )
      .addButton((button) =>
        button.setButtonText('Add disabled').onClick(async () => {
          const parsed = mcpServiceSchema.safeParse({
            id: crypto.randomUUID(),
            name,
            url,
            enabled: false,
          });
          if (!parsed.success) {
            new Notice('Enter a service name and a valid HTTPS endpoint without credentials.');
            return;
          }
          if (this.options.settings().services.length >= 20) {
            new Notice('At most 20 MCP services can be configured.');
            return;
          }
          this.options.settings().services.push(parsed.data);
          await this.options.save();
          container.empty();
          this.renderSettings(container);
        }),
      );
  }
}

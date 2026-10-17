import './dom';
import {
  highlightEdit,
  highlightChanges,
  noteHighlights,
  highlightStyle,
  highlightShapes,
  textColorEdit,
  textColors,
  type HighlightColor,
  type TextColor,
  type WrapTag,
} from './highlight';
import { assistantIcon } from './logos';
import { featuredModelLabels, createOtherModelPicker, type ModelPricing } from './model-picker';
import { commandShortcut, renderShortcutSettings } from './hotkeys';
import {
  createAssistant,
  assistantInvocation,
  commentBody,
  providers,
  providerSchema,
  cachedChatgptModels,
  claudeModels,
  type AssistantBackend,
  type ProviderId,
} from './ai';
import {
  SessionUnavailable,
  OutcomeUnknown,
  questionContext,
  type ConversationMessage,
  type CodexSkill,
} from './codex';
import {
  MarkdownView,
  MarkdownRenderChild,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  TFile,
  setIcon,
  editorInfoField,
  editorLivePreviewField,
  type MarkdownPostProcessorContext,
  type SettingDefinitionItem,
  type SettingDefinition,
} from 'obsidian';
import { StateEffect } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  clearReadingMarks,
  markReadingAnchor,
  sectionBounds,
  selectedSourceRange,
} from './reading';
import {
  dataSchema,
  emptyData,
  locateAnchor,
  makeAnchor,
  mapAnchor,
  renameThreads,
  type Anchor,
  type PluginData,
  type Thread,
  type ReplyQuote,
} from './model';
import { mentionMenu } from './mentions';
import { CommentMarkdown } from './markdown';
import { AgentAccess } from './agent-access';
import logoUrl from '../assets/annotate-icon.png';

declare const ANNOTATE_DEVELOPMENT: boolean;
declare const ANNOTATE_BUILD_DIRECTORY: string;

/** Keep UI timers with their owning window, including cancellation after a popout closes. */
function uiDelay(doc: Document, callback: () => void, milliseconds: number): () => void {
  const win = doc.defaultView;
  const timer = win?.setTimeout(callback, milliseconds);
  return () => {
    if (timer !== undefined) win?.clearTimeout(timer);
  };
}

function pluginLogo(doc: Document): HTMLImageElement {
  const image = doc.win.createEl('img');
  image.className = 'annotate-logo';
  image.src = logoUrl;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  return image;
}

const refresh = StateEffect.define<null>();
type Target = {
  kind: 'editor' | 'reading';
  path: string;
  anchor: Anchor;
  text: () => string | Promise<string>;
};
type ReadingSection = {
  root: HTMLElement;
  path: string;
  source: string;
  context: MarkdownPostProcessorContext;
  dirty: boolean;
};

const ICONS = {
  comment: 'message-square',
  edit: 'pencil',
  check: 'check',
  trash: 'trash-2',
  x: 'x',
  up: 'arrow-up',
  sparkle: 'sparkles',
  stop: 'square',
  refresh: 'refresh-cw',
  undo: 'undo-2',
  reply: 'reply',
  copy: 'copy',
  expand: 'maximize-2',
  shrink: 'minimize-2',
} as const;
function icon(doc: Document, name: keyof typeof ICONS): HTMLElement {
  const element = doc.win.createSpan();
  element.className = 'annotate-icon';
  element.setAttribute('aria-hidden', 'true');
  setIcon(element, ICONS[name]);
  return element;
}
function iconButton(
  doc: Document,
  name: keyof typeof ICONS,
  label: string,
  cls = '',
): HTMLButtonElement {
  const button = doc.win.createEl('button');
  button.type = 'button';
  button.className = `annotate-icon-button ${cls}`.trim();
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(doc, name));
  return button;
}
function copyButton(
  doc: Document,
  label: string,
  text: () => string,
  cls: string,
): HTMLButtonElement {
  const button = iconButton(doc, 'copy', label, cls);
  let reset: (() => void) | undefined;
  const copy = async () => {
    try {
      const clipboard = doc.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error('Clipboard unavailable');
      await clipboard.writeText(text());
      reset?.();
      button.replaceChildren(icon(doc, 'check'));
      button.setAttribute('aria-label', 'Copied');
      button.title = 'Copied';
      reset = uiDelay(
        doc,
        () => {
          if (!button.isConnected) return;
          button.replaceChildren(icon(doc, 'copy'));
          button.setAttribute('aria-label', label);
          button.title = label;
        },
        1500,
      );
    } catch {
      new Notice('Could not copy to clipboard. Try again.');
    }
  };
  button.addEventListener('click', () => void copy());
  return button;
}
function threadText(thread: Thread): string {
  const quote = (text: string) =>
    text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  return [
    quote(thread.anchor.quote),
    ...thread.comments.map((comment) =>
      [
        `${comment.role === 'assistant' ? providers[comment.provider ?? 'chatgpt'].name : comment.author}:`,
        ...(comment.quote ? [quote(comment.quote.text)] : []),
        comment.body,
      ].join('\n\n'),
    ),
  ].join('\n\n---\n\n');
}
function countBadge(doc: Document, thread: Thread): HTMLButtonElement {
  const button = doc.win.createEl('button'),
    count = doc.win.createSpan();
  button.className = 'annotate-count';
  count.textContent = String(thread.comments.length);
  button.append(icon(doc, 'comment'), count);
  button.setAttribute('aria-label', `Open comment thread: ${thread.anchor.quote}`);
  return button;
}
export function relativeTime(time: number, now = Date.now()): string {
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return 'Just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d ago`;
  const date = new Date(time);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
}
/** Collapses a list item's height and opacity before removing it. */
function collapse(item: HTMLElement): void {
  item.setCssStyles({ height: `${item.offsetHeight}px` });
  void item.offsetHeight;
  item.classList.add('annotate-is-leaving');
  item.setCssStyles({ height: '0px' });
  uiDelay(item.ownerDocument, () => item.remove(), 200);
}
const initial = (name: string) => (name.trim() || '?').slice(0, 1).toUpperCase();
const thinking = (status?: string) => status === 'pending' || status === 'streaming';
class StorageConflict extends Error {}
const dataFingerprint = (data: PluginData): string => JSON.stringify(dataSchema.parse(data));
function messageBody(comment: Thread['comments'][number]): string {
  if (comment.body) return comment.body;
  if (comment.role !== 'assistant' || thinking(comment.status)) return '';
  return comment.status === 'cancelled'
    ? 'Response stopped.'
    : comment.status === 'unknown'
      ? 'Response was interrupted.'
      : 'No response received.';
}

class ReadingLifecycle extends MarkdownRenderChild {
  constructor(
    root: HTMLElement,
    private cleanup: () => void,
  ) {
    super(root);
  }
  onunload(): void {
    this.cleanup();
  }
}

class CountWidget extends WidgetType {
  private count: number;
  constructor(
    private plugin: Annotate,
    private thread: Thread,
  ) {
    super();
    this.count = thread.comments.length;
  }
  eq(other: CountWidget): boolean {
    return this.thread.id === other.thread.id && this.count === other.count;
  }
  toDOM(view: EditorView): HTMLElement {
    const button = countBadge(view.dom.ownerDocument, this.thread);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.plugin.openThread(this.thread, button.getBoundingClientRect(), view.dom.ownerDocument);
    });
    return button;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export default class Annotate extends Plugin {
  data: PluginData = emptyData();
  private views = new Set<EditorView>();
  private documents = new Map<string, string>();
  private readingSections = new Map<HTMLElement, ReadingSection>();
  private popup: HTMLElement | null = null;
  private draft: { target: Target; view: EditorView | null } | null = null;
  private disposePopup: (() => void) | null = null;
  private selectionHandlers = new WeakMap<HTMLElement, () => void>();
  private saveTimer: ReturnType<Window['setTimeout']> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private storageHealthy = true;
  private storedData = dataFingerprint(emptyData());
  private conflictBackup: string | null = null;
  private conflictNotified = false;
  private conflictBackups = new Map<string, string>();
  backend: AssistantBackend | null = null;
  connectionLabels = new Map<ProviderId, HTMLElement>();
  chatgptModels: Record<string, string> = {};
  opencodeModels: Record<string, string> = {};
  opencodeModelPricing: Record<string, ModelPricing> = {};
  private connectionProbes = new Map<ProviderId, AssistantBackend>();
  private connectionChecks = new Map<
    ProviderId,
    {
      state: 'checking' | 'ready' | 'error';
      model: string | null;
      detail: string;
    }
  >();
  private openThreadId: string | null = null;
  private quoteReply: ((quote: ReplyQuote) => void) | null = null;
  private markdown = new CommentMarkdown();
  private submissions = new Set<string>();
  private cancellations = new Set<string>();
  private retiring = new Set<HTMLElement>();
  private drafts = new Map<string, string>();
  private toast: { element: HTMLElement; timer?: () => void } | null = null;
  private pulseId: string | null = null;
  private pulseTimer: (() => void) | undefined;
  private refreshPending = false;
  private skillsRequest: Promise<CodexSkill[]> | null = null;
  private accessController: AgentAccess | null = null;
  private contextRequests = new Map<string, AbortController>();
  get agentAccess(): AgentAccess {
    return (this.accessController ??= new AgentAccess({
      app: this.app,
      directory: () => this.manifest.dir ?? `${this.app.vault.configDir}/plugins/annotate`,
      settings: () => this.data.agent,
      save: () => this.persistOrThrow(),
      reconfigure: () => this.configureCodex(),
    }));
  }
  createBackend(provider: ProviderId = this.data.assistant.provider): AssistantBackend {
    const update = () => this.paintCodex();
    if (provider === 'chatgpt')
      return createAssistant(
        {
          provider,
          ...this.data.codex,
          security: {
            tools: this.agentAccess.tools(),
            webSearch: this.data.agent.webSearch,
            home: this.agentAccess.codexHome(),
          },
        },
        update,
      );
    return createAssistant({ provider, ...this.data.assistant[provider] }, update);
  }
  private assistantName(): string {
    return providers[this.data.assistant.provider].name;
  }
  loadSkills(): Promise<CodexSkill[]> {
    return (this.skillsRequest ??= (async () => {
      const backend =
        this.data.assistant.provider === 'chatgpt' && this.backend
          ? this.backend
          : this.createBackend('chatgpt');
      const temporary = backend !== this.backend;
      try {
        if (temporary) await backend.enable();
        return (await backend.listSkills?.()) ?? [];
      } catch (error) {
        this.skillsRequest = null;
        new Notice(
          `Could not load Codex skills: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      } finally {
        if (temporary) backend.disable();
      }
    })());
  }
  configureCodex(): void {
    this.accessController?.cancelApprovals();
    for (const request of this.contextRequests.values()) request.abort();
    this.skillsRequest = null;
    this.connectionChecks.delete(this.data.assistant.provider);
    this.backend?.disable();
    this.backend = null;
    if (this.data.codex.enabled) {
      this.backend = this.createBackend();
      void this.backend.enable().catch(() => this.paintCodex());
    }
    this.paintCodex();
  }
  paintConnections(): void {
    for (const [provider, label] of this.connectionLabels) {
      const checked = this.connectionChecks.get(provider);
      const active = provider === this.data.assistant.provider ? this.backend : null;
      const connection = checked && checked.state !== 'ready' ? checked : (active ?? checked);
      const state = connection?.state ?? 'disabled';
      const tone =
        state === 'ready' || state === 'error' ? state : state === 'disabled' ? 'idle' : 'checking';
      label.dataset.state = tone;
      const text = {
        ready: 'Ready',
        error: 'Not connected',
        idle: 'Not checked',
        checking: 'Checking…',
      }[tone];
      label.textContent = [text, connection?.detail].filter(Boolean).join(' · ');
    }
  }
  async checkConnection(provider: ProviderId = this.data.assistant.provider): Promise<boolean> {
    if (this.connectionProbes.has(provider)) return false;
    const name = providers[provider].name;
    const probe = this.createBackend(provider);
    this.connectionProbes.set(provider, probe);
    this.connectionChecks.set(provider, { state: 'checking', model: null, detail: '' });
    this.paintConnections();
    try {
      await probe.enable();
      if (probe.state !== 'ready') throw new Error('Connection did not become ready.');
      if (provider === 'chatgpt' && probe.models && Object.keys(probe.models).length)
        this.chatgptModels = probe.models;
      this.connectionChecks.set(provider, { state: 'ready', model: probe.model, detail: '' });
      new Notice(`${name} connection is ready.`);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.connectionChecks.set(provider, { state: 'error', model: null, detail });
      new Notice(`${name} connection failed: ${detail}`, 10000);
      return false;
    } finally {
      if (provider === 'opencode' && probe.models) {
        this.opencodeModels = probe.models;
        this.opencodeModelPricing = probe.modelPricing ?? {};
      }
      probe.disable();
      this.connectionProbes.delete(provider);
      this.paintConnections();
    }
  }
  private messageElement(list: Element, thread: Thread, comment: Thread['comments'][number]): void {
    const owner = list.ownerDocument,
      item = owner.win.createEl('article'),
      heading = owner.win.createDiv(),
      avatar = owner.win.createSpan(),
      author = owner.win.createEl('strong'),
      time = owner.win.createEl('time'),
      body = owner.win.createDiv();
    const ai = comment.role === 'assistant';
    item.dataset.messageId = comment.id;
    item.className = ai ? 'annotate-message annotate-message-ai' : 'annotate-message';
    avatar.className = ai ? 'annotate-avatar annotate-avatar-ai' : 'annotate-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (ai) avatar.append(assistantIcon(owner, comment.provider ?? 'chatgpt'));
    else avatar.textContent = initial(comment.author);
    author.textContent = ai ? providers[comment.provider ?? 'chatgpt'].name : comment.author;
    time.dateTime = new Date(comment.createdAt).toISOString();
    time.textContent = relativeTime(comment.createdAt);
    time.title = new Date(comment.createdAt).toLocaleString();
    heading.className = 'annotate-message-heading';
    heading.append(avatar, author, time);
    const actions = owner.win.createDiv();
    actions.className = 'annotate-message-actions';
    const edit = iconButton(owner, 'edit', 'Edit comment', 'annotate-message-edit');
    const remove = iconButton(owner, 'trash', 'Remove comment', 'annotate-message-remove');
    const reply = iconButton(owner, 'reply', 'Quote and reply', 'annotate-message-reply');
    const copy = copyButton(owner, 'Copy message', () => comment.body, 'annotate-message-copy');
    reply.hidden = thread.resolved;
    let selectedText = '';
    const selectedReply = owner.win.createEl('button');
    selectedReply.type = 'button';
    selectedReply.className = 'annotate-selection-reply annotate-pill';
    selectedReply.textContent = 'Quote and reply';
    selectedReply.hidden = true;
    const captureSelection = () => {
      const selection = owner.getSelection();
      selectedText =
        selection &&
        !selection.isCollapsed &&
        body.contains(selection.anchorNode) &&
        body.contains(selection.focusNode)
          ? selection.toString().trim()
          : '';
      selectedReply.hidden = !selectedText || thread.resolved;
      if (!selectedReply.hidden && selection?.rangeCount) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const width = owner.defaultView?.innerWidth ?? 800;
        const height = owner.defaultView?.innerHeight ?? 600;
        const button = selectedReply.getBoundingClientRect();
        const above = rect.top - button.height - 8;
        selectedReply.setCssStyles({
          left: `${Math.max(12, Math.min(rect.left, width - button.width - 12))}px`,
        });
        selectedReply.setCssStyles({
          top: `${Math.max(12, Math.min(above >= 12 ? above : rect.bottom + 8, height - button.height - 12))}px`,
        });
      }
    };
    this.selectionHandlers.set(body, captureSelection);
    const startReply = (text: string) => {
      if (!text || thread.resolved || !thread.comments.includes(comment)) return;
      this.quoteReply?.({ messageId: comment.id, text });
      selectedReply.hidden = true;
      owner.getSelection()?.removeAllRanges();
    };
    for (const button of [copy, reply, edit, remove, selectedReply])
      button.addEventListener('mousedown', (event) => event.preventDefault());
    reply.addEventListener('click', () => {
      captureSelection();
      startReply(selectedText || comment.body);
    });
    selectedReply.addEventListener('click', () => startReply(selectedText));
    actions.append(copy, reply, edit, remove);
    heading.append(actions);
    edit.addEventListener('click', () => {
      if (this.threadBusy(thread) || item.querySelector('.annotate-message-editor')) return;
      const form = owner.win.createEl('form'),
        input = owner.win.createEl('textarea'),
        buttons = owner.win.createDiv();
      const save = owner.win.createEl('button'),
        cancel = owner.win.createEl('button');
      form.className = 'annotate-message-editor';
      input.value = comment.body;
      input.rows = Math.min(8, Math.max(2, comment.body.split('\n').length));
      input.setAttribute('aria-label', 'Edit comment text');
      save.type = 'submit';
      save.textContent = 'Save';
      save.disabled = !input.value.trim();
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      buttons.append(cancel, save);
      form.append(input, buttons);
      body.hidden = true;
      item.classList.add('annotate-is-editing');
      item.append(form);
      const close = () => {
        form.remove();
        body.hidden = false;
        item.classList.remove('annotate-is-editing');
        edit.focus({ preventScroll: true });
      };
      cancel.addEventListener('click', close);
      input.addEventListener('input', () => {
        save.disabled = !input.value.trim() || this.threadBusy(thread);
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!input.value.trim() || this.threadBusy(thread) || !thread.comments.includes(comment))
          return;
        comment.body = input.value;
        if (comment.role === 'assistant') comment.status = 'completed';
        this.resetEditedConversation(thread);
        this.paintBody(body, comment, thread.path);
        close();
        this.changed();
        void this.persist();
        this.paintCodex();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.isComposing &&
          // Safari/Electron IME can report legacy composition key 229 after isComposing resets.
          event.keyCode !== 229
        ) {
          event.preventDefault();
          event.stopPropagation();
          form.requestSubmit();
        }
      });
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
    remove.addEventListener('click', () => {
      if (this.threadBusy(thread) || !thread.comments.includes(comment)) return;
      const index = thread.comments.indexOf(comment),
        threadIndex = this.data.threads.indexOf(thread),
        codex = thread.codex && structuredClone(thread.codex);
      thread.comments = thread.comments.filter((message) => message.id !== comment.id);
      const removedThread = !thread.comments.length;
      if (removedThread) {
        this.data.threads = this.data.threads.filter((t) => t.id !== thread.id);
        this.closePopup();
      } else {
        this.resetEditedConversation(thread);
        this.markdown.remove(body);
        collapse(item);
        this.paintCodex();
      }
      this.changed();
      void this.persist();
      this.showUndo(owner, removedThread ? 'Thread deleted' : 'Comment removed', () => {
        if (thread.comments.includes(comment)) return;
        thread.comments.splice(Math.min(index, thread.comments.length), 0, comment);
        if (removedThread && !this.data.threads.includes(thread))
          this.data.threads.splice(Math.min(threadIndex, this.data.threads.length), 0, thread);
        if (!this.threadBusy(thread) && !thread.codex?.sessionId) thread.codex = codex;
        this.changed();
        void this.persist();
        if (this.openThreadId === thread.id) this.openThread(thread, this.anchorRect, owner);
      });
    });
    body.className = 'annotate-message-body markdown-rendered';
    body.addEventListener('click', (event) => {
      const target = event.targetNode;
      const link = target?.instanceOf(Element) ? target.closest('a.internal-link') : null;
      const href = link?.getAttribute('data-href') ?? link?.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      void this.app.workspace.openLinkText(href, thread.path, event.metaKey || event.ctrlKey);
    });
    this.paintBody(body, comment, thread.path);
    item.append(heading);
    if (comment.quote) {
      const quoted = owner.win.createEl('blockquote');
      quoted.className = 'annotate-reply-quote';
      quoted.textContent = comment.quote.text;
      quoted.title = comment.quote.text;
      item.append(quoted);
    }
    item.append(body, selectedReply);
    list.append(item);
  }
  private highlightClass(thread: Thread): string {
    return [
      'annotate-highlight',
      ...(thread.id === this.openThreadId ? ['annotate-is-active'] : []),
      ...(thread.id === this.pulseId ? ['annotate-pulse'] : []),
    ].join(' ');
  }
  private threadBusy(thread: Thread): boolean {
    return this.submissions.has(thread.id) || thinking(thread.codex?.status);
  }
  private resetEditedConversation(thread: Thread): void {
    if (thread.codex) thread.codex = { status: 'idle', contextVersion: 2 };
  }
  private paintBody(body: HTMLElement, comment: Thread['comments'][number], path: string): void {
    const text = messageBody(comment);
    this.markdown.paint(this.app, body, text, path);
    body.classList.toggle(
      'annotate-typing',
      comment.role === 'assistant' && thinking(comment.status) && !comment.body,
    );
    body.classList.toggle(
      'annotate-streaming',
      comment.role === 'assistant' && comment.status === 'streaming' && !!comment.body,
    );
    body.classList.toggle(
      'annotate-message-note',
      !comment.body && comment.role === 'assistant' && !thinking(comment.status),
    );
  }
  private paintCodex(): void {
    const name = this.assistantName();
    this.paintConnections();
    const thread = this.data.threads.find((t) => t.id === this.openThreadId),
      panel = this.popup;
    if (!panel || !thread) return;
    const status = panel.querySelector<HTMLElement>('.annotate-codex-status');
    const state = this.backend?.state ?? 'disabled',
      turn = thread.codex?.status ?? 'idle';
    if (status) {
      const error = thread.codex?.error ?? (state !== 'ready' ? this.backend?.detail : undefined);
      const text =
        turn === 'pending'
          ? `${name} is reading the note…`
          : turn === 'streaming'
            ? `${name} is writing…`
            : ['failed', 'unknown', 'unavailable'].includes(turn)
              ? (error ?? `${name} could not finish this response.`)
              : state === 'disabled'
                ? `${name} is off. Enable the assistant in settings to ask questions.`
                : state !== 'ready'
                  ? `${name} is ${state}${error ? ' — ' + error : '…'}`
                  : '';
      const activity = thread.codex?.sessionId
        ? this.backend?.activity?.get(thread.codex.sessionId)
        : undefined;
      const toolLabel =
        activity &&
        {
          commandExecution: 'Running a command…',
          webSearch: 'Searching the web…',
          mcpToolCall: 'Using a connected tool…',
          fileChange: 'Editing files…',
        }[activity];
      status.textContent = thinking(turn) && toolLabel ? `${name}: ${toolLabel}` : text;
      status.hidden = !status.textContent;
      status.classList.toggle('annotate-status-live', thinking(turn));
      status.classList.toggle(
        'annotate-status-error',
        ['failed', 'unknown', 'unavailable'].includes(turn) || state === 'error',
      );
      status.title = `${name}: ${state} · ${turn}${this.backend?.model ? ' · ' + this.backend.model : ''}`;
    }
    const list = panel.querySelector<HTMLElement>('.annotate-messages');
    if (list) {
      for (const comment of thread.comments) {
        let item = [...list.querySelectorAll<HTMLElement>('[data-message-id]')].find(
          (el) => el.dataset.messageId === comment.id,
        );
        if (!item) {
          this.messageElement(list, thread, comment);
          item = list.lastElementChild?.instanceOf(HTMLElement) ? list.lastElementChild : undefined;
        }
        const body = item?.querySelector<HTMLElement>('.annotate-message-body');
        if (body) this.paintBody(body, comment, thread.path);
      }
      for (const button of list.querySelectorAll<HTMLButtonElement>(
        '.annotate-message-edit, .annotate-message-remove',
      ))
        button.disabled = this.threadBusy(thread);
      for (const form of list.querySelectorAll<HTMLFormElement>('.annotate-message-editor')) {
        const input = form.querySelector('textarea'),
          save = form.querySelector<HTMLButtonElement>('button[type=submit]');
        if (input && save) save.disabled = this.threadBusy(thread) || !input.value.trim();
      }
    }
    const reconnect = panel.querySelector<HTMLButtonElement>('.annotate-codex-reconnect');
    if (reconnect)
      reconnect.hidden =
        state === 'ready' || state === 'connecting' || state === 'reconnecting' || thinking(turn);
    const cancel = panel.querySelector<HTMLButtonElement>('.annotate-codex-cancel');
    if (cancel) cancel.hidden = !thinking(turn);
    const reset = panel.querySelector<HTMLButtonElement>('.annotate-codex-reset');
    if (reset) reset.hidden = !['unavailable', 'unknown'].includes(turn);
    const bar = panel.querySelector<HTMLElement>('.annotate-ai-bar');
    if (bar)
      bar.hidden = [...bar.children].every(
        (child) => child.instanceOf(HTMLElement) && child.hidden,
      );
  }
  private async requestCodex(
    thread: Thread,
    question: string,
    history: ConversationMessage[],
    quote?: ReplyQuote,
    skill?: CodexSkill,
  ): Promise<void> {
    const backend = this.backend;
    if (!backend || !this.data.codex.enabled) return;
    this.submissions.add(thread.id);
    this.cancellations.delete(thread.id);
    const contextRequest = new AbortController();
    this.contextRequests.set(thread.id, contextRequest);

    let response: Thread['comments'][number] | undefined;
    const provider = this.data.assistant.provider;
    if ((thread.codex?.provider ?? 'chatgpt') !== provider)
      thread.codex = { status: 'idle', provider };
    if (thread.codex?.historyDirty) {
      thread.codex.sessionId = undefined;
      thread.codex.historyDirty = false;
    }
    thread.codex = { ...thread.codex, provider, status: 'pending', error: undefined };
    this.paintCodex();
    try {
      const sessionId = await backend.session(thread.codex.sessionId);
      if (
        !(await this.agentAccess.ensureContext(
          thread.path,
          providers[provider].name,
          contextRequest.signal,
        ))
      )
        throw new Error('Note access was declined. No note context was sent.');
      if (
        this.disposed ||
        this.backend !== backend ||
        !this.data.threads.includes(thread) ||
        this.cancellations.has(thread.id)
      ) {
        thread.codex.status = 'cancelled';
        this.changed();
        this.paintCodex();
        return;
      }
      const isNewConversation = !thread.codex.sessionId;
      thread.codex.sessionId = sessionId;
      thread.codex.contextVersion = 2;
      const message: Thread['comments'][number] = {
        id: crypto.randomUUID(),
        author: providers[provider].name,
        provider,
        body: '',
        role: 'assistant',
        status: 'pending',
        createdAt: Date.now(),
      };
      response = message;
      thread.comments.push(message);
      thread.codex.turnMessageId = message.id;
      await this.persistOrThrow();
      const content = this.documents.get(thread.path) ?? (await this.noteText(thread.path));
      if (content === null)
        throw new Error('The annotated Markdown note is unavailable. No request was sent.');
      if (this.cancellations.has(thread.id) || this.backend !== backend) {
        message.status = 'cancelled';
        thread.codex.status = 'cancelled';
        this.changed();
        this.paintCodex();
        return;
      }
      this.paintCodex();
      await backend.ask(
        sessionId,
        questionContext(
          content,
          thread.anchor.quote,
          question,
          isNewConversation || backend.retainsHistory === false ? history : [],
          quote,
        ),
        (delta) => {
          if (!thread.codex) return;
          message.body += delta;
          message.status = 'streaming';
          thread.codex.status = 'streaming';
          this.paintCodex();
          this.scheduleSave();
        },
        (state, error) => {
          if (!thread.codex) return;
          message.status = state;
          thread.codex.status = state;
          thread.codex.error = error;
          this.changed();
          this.paintCodex();
          void this.persist();
        },
        skill,
      );
    } catch (error) {
      if (thread.codex) {
        thread.codex.status =
          error instanceof SessionUnavailable
            ? 'unavailable'
            : error instanceof OutcomeUnknown
              ? 'unknown'
              : 'failed';
        thread.codex.error = error instanceof Error ? error.message : 'Assistant request failed.';
      }
      if (response) response.status = error instanceof OutcomeUnknown ? 'unknown' : 'failed';
      this.changed();
      this.paintCodex();
    } finally {
      this.contextRequests.delete(thread.id);
      this.submissions.delete(thread.id);
      this.paintCodex();
    }
  }
  private async record(thread: Thread, body: string, quote?: ReplyQuote): Promise<boolean> {
    const savedBody = commentBody(body) ?? body;
    if (!savedBody.trim()) {
      new Notice('Add some comment text after @comment.');
      return false;
    }
    let invocation: ReturnType<typeof assistantInvocation>;
    try {
      invocation = assistantInvocation(
        body,
        this.data.codex.enabled ? this.data.assistant.provider : undefined,
      );
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Invalid assistant mention.');
      return false;
    }
    let skill: CodexSkill | undefined;
    const slash = /^@chatgpt\s+\/([\w:.-]+)(?:\s+([\s\S]*))?$/i.exec(body.trim());
    if (slash) {
      skill = (await this.loadSkills()).find((entry) => entry.name === slash[1]);
      if (skill)
        invocation = {
          provider: 'chatgpt',
          question: slash[2]?.trim() || 'Apply the selected skill to the highlighted passage.',
        };
    }
    const question = invocation?.question ?? null;
    if (question !== null) {
      if (!question) {
        new Notice(`Add a question after @${this.data.assistant.provider}.`);
        return false;
      }
      if (!this.data.codex.enabled) {
        new Notice('Enable the assistant in Annotate settings first.');
        return false;
      }
      if (invocation && invocation.provider !== this.data.assistant.provider) {
        if (this.data.threads.some((t) => this.threadBusy(t))) {
          new Notice('Finish or stop the current response before switching assistants.');
          return false;
        }
        this.data.assistant.provider = invocation.provider;
        this.configureCodex();
      }
      if (
        this.submissions.has(thread.id) ||
        ['pending', 'streaming', 'unknown', 'unavailable'].includes(thread.codex?.status ?? '')
      ) {
        new Notice('Finish or cancel this response, or start a new conversation to recover.');
        return false;
      }
    }
    const history: ConversationMessage[] = thread.comments
      .filter((c) => c.body.length > 0)
      .map((c) => ({
        role: c.role === 'assistant' ? 'assistant' : 'user',
        content:
          c.role === 'assistant' || (c.role === 'user' && !c.provider)
            ? c.body
            : (assistantInvocation(c.body)?.question ?? c.body),
        quote: c.quote,
      }));
    thread.comments.push({
      id: crypto.randomUUID(),
      author: this.data.author || 'You',
      body: savedBody,
      role: 'user',
      ...(invocation ? { provider: invocation.provider } : {}),
      ...(quote ? { quote } : {}),
      createdAt: Date.now(),
    });
    if (question === null && thread.codex) thread.codex.historyDirty = true;
    this.changed();
    await this.persistOrThrow();
    if (question !== null) void this.requestCodex(thread, question, history, quote, skill);
    return true;
  }

  async onload(): Promise<void> {
    const raw: unknown = await this.loadData();
    if (raw !== null && raw !== undefined) {
      const parsed = dataSchema.safeParse(raw);
      if (!parsed.success) {
        this.storageHealthy = false;
        new Notice(
          'Annotate: invalid saved data. Back up data.json and repair it before enabling the plugin.',
        );
        return;
      }
      this.data = parsed.data;
    }
    this.storedData = dataFingerprint(this.data);
    this.recoverConversations(this.data);
    this.configureCodex();
    this.scheduleSave();
    // The nested CodeMirror class has its own `this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- CodeMirror classes need the enclosing plugin instance.
    const plugin = this;
    this.registerEditorExtension(
      ViewPlugin.fromClass(
        class {
          decorations: DecorationSet;
          hiddenTags: DecorationSet;
          path: string | null;
          constructor(readonly view: EditorView) {
            plugin.views.add(view);
            plugin.watchSelections(view.dom.ownerDocument);
            this.path = view.state.field(editorInfoField, false)?.file?.path ?? null;
            if (this.path) plugin.reconcile(this.path, view.state.doc.toString());
            this.decorations = plugin.decorations(view, this.path);
            this.hiddenTags = plugin.highlightTagDecorations(view);
          }
          update(update: ViewUpdate): void {
            const path = update.state.field(editorInfoField, false)?.file?.path ?? null;
            if (path && (update.docChanged || path !== this.path)) {
              const text = update.state.doc.toString();
              const previous = plugin.documents.get(path);
              if (update.docChanged && previous === update.startState.doc.toString()) {
                for (const thread of plugin.data.threads.filter((t) => t.path === path)) {
                  thread.anchor = mapAnchor(thread.anchor, update.changes, text);
                }
                plugin.documents.set(path, text);
                plugin.scheduleSave();
                plugin.refreshViews(update.view);
              } else if (previous !== text) plugin.reconcile(path, text);
            }
            const pathChanged = path !== this.path;
            const previousPath = this.path;
            this.path = path;
            if (pathChanged) plugin.releaseDocument(previousPath);
            if (
              pathChanged ||
              update.docChanged ||
              update.viewportChanged ||
              update.transactions.some((t) => t.effects.some((e) => e.is(refresh)))
            ) {
              this.decorations = plugin.decorations(update.view, path);
              this.hiddenTags = plugin.highlightTagDecorations(update.view);
            }
          }
          destroy(): void {
            plugin.views.delete(this.view);
            plugin.releaseDocument(this.path);
          }
        },
        {
          decorations: (value) => value.decorations,
          provide: (extension) =>
            EditorView.atomicRanges.of(
              (view) => view.plugin(extension)?.hiddenTags ?? Decoration.none,
            ),
          eventHandlers: {
            click: (event, view) => {
              const element = event.targetNode;
              if (!element?.instanceOf(Element)) return false;
              const mark = element.closest('[data-annotate-thread]');
              const id = mark?.getAttribute('data-annotate-thread');
              const thread = plugin.data.threads.find((t) => t.id === id);
              if (thread && view.state.selection.main.empty && mark) {
                plugin.openThread(thread, mark.getBoundingClientRect(), view.dom.ownerDocument);
              }
              return false;
            },
          },
        },
      ),
    );
    this.registerMarkdownPostProcessor(async (root, context) => {
      this.watchSelections(root.ownerDocument);
      const source = await this.noteText(context.sourcePath);
      if (this.disposed || source === null || !context.getSectionInfo(root)) return;
      if (this.documents.get(context.sourcePath) !== source)
        this.reconcile(context.sourcePath, source);
      const section: ReadingSection = {
        root,
        path: context.sourcePath,
        source,
        context,
        dirty: false,
      };
      this.readingSections.set(root, section);
      context.addChild(
        new ReadingLifecycle(root, () => {
          this.readingSections.delete(root);
          clearReadingMarks(root);
          this.releaseDocument(section.path);
        }),
      );
      this.renderReadingSection(section);
    }, 1000);
    this.app.workspace.onLayoutReady(() => {
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview')
          leaf.view.previewMode.rerender(true);
      }
    });
    this.watchSelections(document);
    this.refreshHighlightStyles();
    this.addCommand({
      id: 'highlight-selection',
      name: 'Highlight selection with last color',
      checkCallback: (checking) => {
        const selected = this.selectedNote();
        if (!selected) return false;
        if (!checking) void this.applyHighlight(selected.target, this.recentHighlight());
        return true;
      },
    });
    this.addCommand({
      id: 'color-selection-text',
      name: 'Color selected text with last color',
      checkCallback: (checking) => {
        const selected = this.selectedNote();
        if (!selected) return false;
        if (!checking) void this.applyTextColor(selected.target, this.recentTextColor());
        return true;
      },
    });
    this.addCommand({
      id: 'add-selection-comment',
      name: 'Comment on selection',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (view.getMode() === 'preview') {
          const target = this.readingSelection(view);
          if (!target) return false;
          if (!checking) this.compose(target.target, target.rect, target.doc);
          return true;
        }
        const editor = view.editor;
        if (!editor.getSelection().trim()) return false;
        if (!checking) {
          const from = editor.posToOffset(editor.getCursor('from'));
          const to = editor.posToOffset(editor.getCursor('to'));
          this.compose({
            kind: 'editor',
            path: view.file.path,
            anchor: makeAnchor(editor.getValue(), from, to),
            text: () => editor.getValue(),
          });
        }
        return true;
      },
    });
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, context) => {
        if (!context.file || !editor.getSelection().trim()) return;
        const path = context.file.path;
        const anchor = makeAnchor(
          editor.getValue(),
          editor.posToOffset(editor.getCursor('from')),
          editor.posToOffset(editor.getCursor('to')),
        );
        menu.addItem((item) =>
          item
            .setTitle('Comment on selection')
            .setIcon('message-square')
            .onClick(() => {
              this.compose({ kind: 'editor', path, anchor, text: () => editor.getValue() });
            }),
        );
      }),
    );
    this.addCommand({
      id: 'show-comment-threads',
      name: 'Show comments for current note',
      callback: () => new ThreadList(this).open(),
    });
    const ribbon = this.addRibbonIcon('message-square-text', 'Annotate', () =>
      new ThreadList(this).open(),
    );
    ribbon?.addClass('annotate-ribbon');
    if (typeof ANNOTATE_DEVELOPMENT !== 'undefined' && ANNOTATE_DEVELOPMENT) {
      this.addCommand({
        id: 'sync-local-build',
        name: 'Sync latest local development build',
        callback: () => void this.syncBuild(),
      });
    }
    this.settingsTab = new CommentsSettings(this);
    this.addSettingTab(this.settingsTab);
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        renameThreads(this.data.threads, oldPath, file.path);
        this.documents.clear();
        this.changed();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        const path = file.path;
        if (
          ![...this.views].some(
            (view) => view.state.field(editorInfoField, false)?.file?.path === path,
          )
        )
          this.documents.delete(path);
      }),
    );
    const refreshReading = () => {
      window.requestAnimationFrame(() => {
        if (this.disposed) return;
        for (const section of this.readingSections.values())
          if (section.dirty && section.root.isShown()) this.renderReadingSection(section);
      });
    };
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.closePopup();
        this.hideSelectionTools();
        refreshReading();
      }),
    );
    this.registerEvent(this.app.workspace.on('layout-change', refreshReading));
    if (typeof ANNOTATE_DEVELOPMENT !== 'undefined' && ANNOTATE_DEVELOPMENT)
      void this.startDevelopmentUpdates();
  }

  private settingsTab: CommentsSettings | null = null;
  private lastDevelopmentInput = 0;
  private composingDocuments = new Set<Document>();
  private stopDevelopmentUpdates: (() => void) | null = null;
  private async startDevelopmentUpdates(): Promise<void> {
    try {
      const { watchDevelopmentBuild } = await import('./sync');
      const stop = await watchDevelopmentBuild({
        source: this.localBuildDirectory,
        destination: this.manifest.dir ?? `${this.app.vault.configDir}/plugins/annotate`,
        adapter: this.app.vault.adapter,
        ready: () =>
          !this.disposed &&
          !this.syncing &&
          !this.popup &&
          !this.data.threads.some(
            (thread) => thread.codex && ['pending', 'streaming'].includes(thread.codex.status),
          ) &&
          this.composingDocuments.size === 0 &&
          Date.now() - this.lastDevelopmentInput > 1200,
        apply: () => this.syncBuild(true),
      });
      if (this.disposed) stop();
      else this.stopDevelopmentUpdates = stop;
    } catch {
      /* Development source may be unavailable on another computer. */
    }
  }
  syncing = false;
  localBuildDirectory =
    typeof ANNOTATE_BUILD_DIRECTORY === 'string' ? ANNOTATE_BUILD_DIRECTORY : '';

  async syncBuild(automatic = false): Promise<boolean> {
    if (typeof ANNOTATE_DEVELOPMENT !== 'undefined' && ANNOTATE_DEVELOPMENT && !this.syncing) {
      this.syncing = true;
      try {
        const { syncLocalBuild } = await import('./sync');
        if (!this.storageHealthy)
          throw new Error('Resolve the comment storage error before syncing.');
        if (this.saveTimer) window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        await this.persistOrThrow();
        const manager: unknown = Reflect.get(this.app, 'plugins');
        if (!manager || typeof manager !== 'object')
          throw new Error('Plugin reload is unavailable.');
        const disable: unknown = Reflect.get(manager, 'disablePlugin');
        const enable: unknown = Reflect.get(manager, 'enablePlugin');
        if (typeof disable !== 'function' || typeof enable !== 'function')
          throw new Error('Plugin reload is unavailable.');
        const restoreSettings = this.settingsTab?.containerEl?.isShown() ?? false;
        const drafts = new Map(this.drafts);
        const version = await syncLocalBuild({
          development: true,
          source: this.localBuildDirectory,
          destination: this.manifest.dir ?? `${this.app.vault.configDir}/plugins/annotate`,
          adapter: this.app.vault.adapter,
          disable: async () => {
            await disable.call(manager, this.manifest.id);
          },
          enable: async () => {
            await enable.call(manager, this.manifest.id);
            const loaded: unknown = Reflect.get(manager, 'plugins');
            if (!loaded || typeof loaded !== 'object' || !Reflect.get(loaded, this.manifest.id))
              throw new Error('The synced build could not load.');
            const plugin: unknown = Reflect.get(loaded, this.manifest.id);
            if (plugin && typeof plugin === 'object') {
              const restored: unknown = Reflect.get(plugin, 'drafts');
              if (restored instanceof Map)
                for (const [key, value] of drafts) restored.set(key, value);
            }
            if (restoreSettings) {
              const settings: unknown = Reflect.get(this.app, 'setting');
              if (settings && typeof settings === 'object') {
                const select: unknown = Reflect.get(settings, 'openTabById');
                if (typeof select === 'function') select.call(settings, this.manifest.id);
              }
            }
          },
        });
        new Notice(
          `Annotate ${version} ${automatic ? 'updated automatically' : 'synced and reloaded'}.`,
        );
        return true;
      } catch (error) {
        new Notice(
          `Annotate update failed: ${error instanceof Error ? error.message : String(error)}`,
          10000,
        );
      } finally {
        this.syncing = false;
      }
    }
    return false;
  }

  onunload(): void {
    this.disposed = true;
    this.settingsTab?.hide();
    this.accessController?.dispose();
    for (const request of this.contextRequests.values()) request.abort();
    this.contextRequests.clear();
    this.stopDevelopmentUpdates?.();
    this.stopDevelopmentUpdates = null;
    this.hideSelectionTools();
    for (const dispose of this.selectionDocuments.values()) dispose();
    this.selectionDocuments.clear();
    for (const [doc, style] of this.highlightStyles)
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== style);
    this.highlightStyles.clear();
    for (const probe of this.connectionProbes.values()) probe.disable();
    this.connectionProbes.clear();
    this.connectionLabels.clear();
    this.backend?.disable();
    this.backend = null;
    this.closePopup();
    for (const panel of [...this.retiring]) this.retire(panel);
    this.dismissToast(true);
    this.pulseTimer?.();
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    if (this.storageHealthy) void this.persist();
    this.views.clear();
    for (const section of this.readingSections.values()) clearReadingMarks(section.root);
    this.readingSections.clear();
    this.documents.clear();
    this.drafts.clear();
  }

  private selectionTools: { element: HTMLElement; target: Target } | null = null;
  private selectionDocuments = new Map<Document, () => void>();
  private highlightStyles = new Map<Document, CSSStyleSheet>();
  private noteHighlightCache = new WeakMap<
    EditorView['state']['doc'],
    { highlights: ReturnType<typeof noteHighlights>; colors: ReturnType<typeof noteHighlights> }
  >();
  private noteTags(view: EditorView) {
    let tags = this.noteHighlightCache.get(view.state.doc);
    if (!tags) {
      const source = view.state.doc.toString();
      tags = { highlights: noteHighlights(source), colors: noteHighlights(source, 'span') };
      this.noteHighlightCache.set(view.state.doc, tags);
    }
    return tags;
  }

  recentTextColor(): TextColor {
    return (
      textColors.find((color) => color.id === this.data.highlights.textRecent) ?? textColors[1]
    );
  }

  recentHighlight(): HighlightColor {
    return (
      this.data.highlights.colors.find((color) => color.id === this.data.highlights.recent) ??
      this.data.highlights.colors[0] ?? { id: 'yellow', name: 'Yellow', value: '#ffe06680' }
    );
  }

  refreshHighlightStyles(): void {
    for (const doc of this.selectionDocuments.keys()) {
      let style = this.highlightStyles.get(doc);
      if (!style) {
        const win = doc.defaultView;
        if (!win) continue;
        style = new win.CSSStyleSheet();
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, style];
        this.highlightStyles.set(doc, style);
      }
      style.replaceSync(
        this.data.highlights.colors
          .map(
            (color) =>
              `[data-annotate-highlight="${color.id}"] { ${highlightStyle(color.value, this.data.highlights.shape).replaceAll(';', ' !important;')} }`,
          )
          .concat(
            textColors.map(
              (color) =>
                `[data-annotate-color="${color.id}"] { color: ${color.value} !important; }`,
            ),
          )
          .join('\n'),
      );
    }
  }

  private hideSelectionTools(): void {
    this.selectionTools?.element.remove();
    this.selectionTools = null;
  }

  private selectedNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return null;
    if (view.getMode() === 'preview') return this.readingSelection(view);
    const editor = view.editor;
    if (!editor?.getSelection().trim()) return null;
    const from = editor.posToOffset(editor.getCursor('from'));
    const to = editor.posToOffset(editor.getCursor('to'));
    const cm = [...this.views].find((cm) => view.containerEl?.contains(cm.dom));
    const a = cm?.coordsAtPos(from, 1),
      b = cm?.coordsAtPos(to, -1);
    const doc = view.containerEl?.ownerDocument ?? document;
    const range = doc.getSelection()?.rangeCount ? doc.getSelection()?.getRangeAt(0) : null;
    const rect =
      a && b
        ? {
            left: Math.min(a.left, b.left),
            right: Math.max(a.right, b.right),
            top: Math.min(a.top, b.top),
            bottom: Math.max(a.bottom, b.bottom),
          }
        : range?.getBoundingClientRect();
    const target: Target = {
      kind: 'editor',
      path: view.file.path,
      anchor: makeAnchor(editor.getValue(), from, to),
      text: () => editor.getValue(),
    };
    return { target, rect, doc };
  }

  private watchSelections(doc: Document): void {
    if (this.selectionDocuments.has(doc)) return;
    let timer: (() => void) | undefined;
    let dragging = false;
    const schedule = () => {
      timer?.();
      timer = uiDelay(
        doc,
        () => {
          if (
            dragging ||
            this.disposed ||
            this.popup ||
            this.selectionTools?.element.contains(doc.activeElement)
          )
            return;
          const selected = this.selectedNote();
          const selection = doc.getSelection();
          const node = selection?.anchorNode;
          const element = node?.nodeType === 1 ? node : node?.parentElement;
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (
            doc.activeElement?.closest('input, textarea, .modal-container, .prompt') ||
            !selected ||
            selected.doc !== doc ||
            !element ||
            !view?.containerEl?.contains(element) ||
            (element.instanceOf(Element) &&
              element.closest('.annotate-panel, input, textarea, .metadata-container'))
          ) {
            this.hideSelectionTools();
            return;
          }
          this.showSelectionTools(selected);
        },
        100,
      );
    };
    const down = (event: MouseEvent) => {
      if (event.targetNode && this.selectionTools?.element.contains(event.targetNode)) return;
      dragging = true;
      this.hideSelectionTools();
    };
    const up = () => {
      dragging = false;
      schedule();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        timer?.();
        this.hideSelectionTools();
      } else schedule();
    };
    const scroll = () => {
      timer?.();
      this.hideSelectionTools();
    };
    const input = () => {
      this.lastDevelopmentInput = Date.now();
    };
    const compositionStart = () => {
      this.composingDocuments.add(doc);
    };
    const compositionEnd = () => {
      this.composingDocuments.delete(doc);
      input();
    };
    doc.addEventListener('input', input, true);
    doc.addEventListener('compositionstart', compositionStart);
    doc.addEventListener('compositionend', compositionEnd);
    doc.addEventListener('mousedown', down);
    doc.addEventListener('mouseup', up);
    doc.addEventListener('keyup', key);
    doc.addEventListener('selectionchange', schedule);
    doc.addEventListener('scroll', scroll, true);
    const dispose = () => {
      timer?.();
      doc.removeEventListener('input', input, true);
      doc.removeEventListener('compositionstart', compositionStart);
      doc.removeEventListener('compositionend', compositionEnd);
      this.composingDocuments.delete(doc);
      doc.removeEventListener('mousedown', down);
      doc.removeEventListener('mouseup', up);
      doc.removeEventListener('keyup', key);
      doc.removeEventListener('selectionchange', schedule);
      doc.removeEventListener('scroll', scroll, true);
      doc.defaultView?.removeEventListener('unload', dispose);
      const sheet = this.highlightStyles.get(doc);
      if (sheet) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((item) => item !== sheet);
      this.highlightStyles.delete(doc);
      this.selectionDocuments.delete(doc);
    };
    this.selectionDocuments.set(doc, dispose);
    doc.defaultView?.addEventListener('unload', dispose);
    this.refreshHighlightStyles();
  }

  private showSelectionTools(selected: NonNullable<ReturnType<Annotate['selectedNote']>>): void {
    const { target, rect, doc } = selected;
    const current = this.selectionTools;
    if (
      current?.element.ownerDocument === doc &&
      current.target.path === target.path &&
      current.target.anchor.from === target.anchor.from &&
      current.target.anchor.to === target.anchor.to &&
      current.target.anchor.quote === target.anchor.quote &&
      current.target.anchor.prefix === target.anchor.prefix &&
      current.target.anchor.suffix === target.anchor.suffix
    )
      return;
    this.hideSelectionTools();
    if (!rect) return;
    const bar = doc.win.createDiv();
    bar.className = 'annotate-selection-tools';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Selection actions');
    bar.addEventListener('mousedown', (event) => event.preventDefault());
    const button = (text: string, action: () => void, glyph?: string) => {
      const button = doc.win.createEl('button');
      button.type = 'button';
      if (glyph) {
        const icon = doc.win.createSpan();
        icon.className = 'annotate-selection-icon';
        icon.setAttribute('aria-hidden', 'true');
        setIcon(icon, glyph);
        button.append(icon);
      }
      const label = doc.win.createSpan();
      label.className = 'annotate-selection-label';
      label.textContent = text;
      button.append(label);
      button.addEventListener('click', action);
      bar.append(button);
      return button;
    };
    const highlight = button(
      'Highlight',
      () => {
        bar.replaceChildren();
        bar.classList.add('annotate-is-palette');
        for (const color of this.data.highlights.colors) {
          const swatch = button(color.name, () => void this.applyHighlight(target, color, true));
          swatch.className = 'annotate-color-swatch';
          swatch.title = color.name;
          swatch.style.setProperty('--annotate-swatch', color.value);
          swatch.setAttribute('aria-label', `Highlight ${color.name}`);
          swatch.setAttribute('aria-pressed', String(color.id === this.recentHighlight().id));
        }
        const separator = doc.win.createSpan();
        separator.className = 'annotate-palette-divider';
        separator.setAttribute('aria-hidden', 'true');
        bar.append(separator);
        const remove = button(
          'Remove',
          () => void this.applyHighlight(target, null, true),
          'eraser',
        );
        remove.className = 'annotate-highlight-remove';
        remove.title = 'Remove highlight';
        remove.setAttribute('aria-label', 'Remove highlight');
        place();
      },
      'highlighter',
    );
    highlight.style.setProperty('--annotate-swatch', this.recentHighlight().value);
    const highlightShortcut = commandShortcut(this.app, 'annotate:highlight-selection');
    highlight.title = ['Choose highlight color', highlightShortcut].filter(Boolean).join(' · ');
    const textColor = button(
      'Color',
      () => {
        bar.replaceChildren();
        bar.classList.add('annotate-is-palette');
        for (const color of textColors) {
          const swatch = button(color.name, () => void this.applyTextColor(target, color, true));
          swatch.className = 'annotate-text-swatch';
          swatch.title = color.name;
          swatch.style.setProperty('--annotate-swatch', color.value);
          swatch.setAttribute('aria-label', `Text color ${color.name}`);
          swatch.setAttribute('aria-pressed', String(color.id === this.recentTextColor().id));
        }
        const separator = doc.win.createSpan();
        separator.className = 'annotate-palette-divider';
        separator.setAttribute('aria-hidden', 'true');
        bar.append(separator);
        const remove = button(
          'Remove',
          () => void this.applyTextColor(target, null, true),
          'eraser',
        );
        remove.className = 'annotate-highlight-remove';
        remove.title = 'Default color';
        remove.setAttribute('aria-label', 'Remove text color');
        place();
      },
      'type',
    );
    textColor.style.setProperty('--annotate-swatch', this.recentTextColor().value);
    textColor.title = [
      'Choose text color',
      commandShortcut(this.app, 'annotate:color-selection-text'),
    ]
      .filter(Boolean)
      .join(' · ');
    const divider = doc.win.createSpan();
    divider.className = 'annotate-selection-divider';
    divider.setAttribute('aria-hidden', 'true');
    bar.append(divider);
    button(
      'Annotate',
      () => {
        this.hideSelectionTools();
        this.compose(target, rect, doc);
      },
      'message-square-plus',
    ).title = commandShortcut(this.app, 'annotate:add-selection-comment') || 'Comment on selection';
    bar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideSelectionTools();
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const buttons = [...bar.querySelectorAll('button')];
        const index = buttons.findIndex((button) => button === doc.activeElement);
        buttons[
          (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length
        ]?.focus();
      }
    });
    doc.body.append(bar);
    this.selectionTools = { element: bar, target };
    const place = () => {
      const win = doc.defaultView;
      if (!win) return;
      const bounds = bar.getBoundingClientRect();
      bar.setCssStyles({
        left: `${Math.max(8, Math.min((rect.left + rect.right - bounds.width) / 2, win.innerWidth - bounds.width - 8))}px`,
      });
      const above = rect.top - bounds.height - 6;
      const top = above >= 8 ? above : rect.bottom + 6;
      bar.setCssStyles({
        top: `${Math.max(8, Math.min(top, win.innerHeight - bounds.height - 8))}px`,
      });
    };
    place();
  }

  private applyHighlight(
    target: Target,
    color: HighlightColor | null,
    reopen = false,
  ): Promise<void> {
    return this.applyWrap(
      target,
      'mark',
      reopen,
      (source, from, to) => highlightEdit(source, from, to, color, this.data.highlights.shape),
      () => {
        if (color) this.data.highlights.recent = color.id;
      },
    );
  }

  private applyTextColor(target: Target, color: TextColor | null, reopen = false): Promise<void> {
    return this.applyWrap(
      target,
      'span',
      reopen,
      (source, from, to) => textColorEdit(source, from, to, color),
      () => {
        if (color) this.data.highlights.textRecent = color.id;
      },
    );
  }

  private async applyWrap(
    target: Target,
    tag: WrapTag,
    reopen: boolean,
    wrap: (source: string, from: number, to: number) => ReturnType<typeof highlightEdit>,
    remember: () => void,
  ): Promise<void> {
    const action = tag === 'mark' ? 'highlight' : 'color';
    this.hideSelectionTools();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file || view.file.path !== target.path) return;
    const transform = (source: string) => {
      const anchor = locateAnchor(target.anchor, source);
      return anchor.orphaned ? null : wrap(source, anchor.from, anchor.to);
    };
    try {
      if (target.kind === 'editor' && view.getMode() !== 'preview') {
        const editor = view.editor;
        const edit = transform(editor.getValue());
        if (!edit) {
          new Notice(`Select note text outside code and HTML tags to ${action}.`);
          return;
        }
        const changes = highlightChanges(editor.getValue(), edit, tag);
        const edits: {
          from: ReturnType<typeof editor.offsetToPos>;
          to: ReturnType<typeof editor.offsetToPos>;
          text: string;
        }[] = [];
        changes.iterChanges((from, to, _fromB, _toB, inserted) => {
          edits.push({
            from: editor.offsetToPos(from),
            to: editor.offsetToPos(to),
            text: inserted.toString(),
          });
        });
        editor.transaction({ changes: edits });
        editor.setSelection(
          editor.offsetToPos(edit.selectionFrom),
          editor.offsetToPos(edit.selectionTo),
        );
        editor.focus();
        // Keep the menu on the same text so color and highlight can be combined.
        if (reopen)
          view.containerEl.ownerDocument.defaultView?.requestAnimationFrame(() => {
            const selected = this.disposed ? null : this.selectedNote();
            if (selected) this.showSelectionTools(selected);
          });
      } else {
        let applied = false;
        await this.app.vault.process(view.file, (source) => {
          const edit = transform(source);
          if (!edit) return source;
          applied = true;
          const changes = highlightChanges(source, edit, tag);
          const updated = source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
          for (const thread of this.data.threads.filter((thread) => thread.path === target.path))
            thread.anchor = mapAnchor(thread.anchor, changes, updated);
          return source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
        });
        if (!applied) {
          new Notice('The selection changed or includes code. Select note text again.');
          return;
        }
        view.containerEl.ownerDocument.getSelection()?.removeAllRanges();
      }
      remember();
      this.scheduleSave();
    } catch (error) {
      new Notice(`Could not ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private releaseDocument(path: string | null): void {
    if (!path) return;
    for (const view of this.views)
      if (view.state.field(editorInfoField, false)?.file?.path === path) return;
    for (const section of this.readingSections.values())
      if (section.path === path && section.root.isConnected) return;
    this.documents.delete(path);
  }

  private async noteText(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
  }
  private renderReadingSection(section: ReadingSection): void {
    const info = section.context.getSectionInfo(section.root);
    if (!info) return;
    section.dirty = false;
    clearReadingMarks(section.root);
    const source = this.documents.get(section.path) ?? section.source;
    const bounds = sectionBounds(source, info.lineStart, info.lineEnd);
    for (const thread of this.data.threads) {
      if (
        thread.path !== section.path ||
        thread.resolved ||
        thread.anchor.orphaned ||
        thread.anchor.from >= bounds.to ||
        thread.anchor.to <= bounds.from
      )
        continue;
      const marks = markReadingAnchor(
        section.root,
        source,
        bounds,
        thread.anchor,
        this.highlightClass(thread),
        thread.id,
      );
      for (const mark of marks)
        mark.addEventListener('click', () => {
          if (mark.ownerDocument.getSelection()?.isCollapsed !== false)
            this.openThread(thread, mark.getBoundingClientRect(), mark.ownerDocument);
        });
      const last = marks.at(-1);
      if (last && thread.anchor.to <= bounds.to) {
        const badge = countBadge(section.root.ownerDocument, thread);
        badge.classList.add('annotate-reading-count');
        badge.addEventListener('click', (event) => {
          event.stopPropagation();
          this.openThread(thread, badge.getBoundingClientRect(), badge.ownerDocument);
        });
        last.after(badge);
      }
    }
    if (this.draft?.view === null && this.draft.target.path === section.path) {
      markReadingAnchor(
        section.root,
        source,
        bounds,
        this.draft.target.anchor,
        'annotate-draft-selection',
      );
    }
  }
  private readingSelection(view: MarkdownView) {
    const doc = view.containerEl.ownerDocument,
      selection = doc.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !selection.toString().trim() ||
      !view.file
    )
      return null;
    const range = selection.getRangeAt(0).cloneRange();
    if (
      !view.containerEl.contains(range.startContainer) ||
      !view.containerEl.contains(range.endContainer)
    )
      return null;
    const path = view.file.path,
      source = this.documents.get(path);
    if (source === undefined) return null;
    let from: number | null = null,
      to: number | null = null;
    for (const section of this.readingSections.values()) {
      if (section.path !== path || !view.containerEl.contains(section.root)) continue;
      const info = section.context.getSectionInfo(section.root);
      if (!info) continue;
      const selected = selectedSourceRange(
        section.root,
        source,
        sectionBounds(source, info.lineStart, info.lineEnd),
        range,
      );
      if (!selected) continue;
      from = from === null ? selected.from : Math.min(from, selected.from);
      to = to === null ? selected.to : Math.max(to, selected.to);
    }
    if (from === null || to === null || to <= from) return null;
    const target: Target = {
      kind: 'reading',
      path,
      anchor: makeAnchor(source, from, to),
      text: async () => (await this.noteText(path)) ?? source,
    };
    return { target, rect: range.getBoundingClientRect(), doc };
  }
  reconcile(path: string, text: string): void {
    for (const thread of this.data.threads.filter((t) => t.path === path))
      thread.anchor = locateAnchor(thread.anchor, text);
    this.documents.set(path, text);
    this.scheduleSave();
  }
  private highlightTagDecorations(view: EditorView): DecorationSet {
    if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
    const { highlights, colors } = this.noteHighlightCache.get(view.state.doc) ?? {
      highlights: [],
      colors: [],
    };
    return Decoration.set(
      [...highlights, ...colors].flatMap((highlight) => [
        Decoration.replace({}).range(highlight.tagFrom, highlight.from),
        Decoration.replace({}).range(highlight.to, highlight.tagTo),
      ]),
      true,
    );
  }
  decorations(view: EditorView, path: string | null): DecorationSet {
    if (!path) return Decoration.none;
    const ranges = [];
    const { highlights, colors } = this.noteTags(view);
    for (const span of colors) {
      const color = textColors.find((color) => color.id === span.id);
      if (
        !color ||
        !view.visibleRanges.some((range) => span.from < range.to && span.to > range.from)
      )
        continue;
      ranges.push(
        Decoration.mark({
          attributes: { 'data-annotate-color': color.id, style: `color: ${color.value};` },
        }).range(span.from, span.to),
      );
    }
    for (const highlight of highlights) {
      const color = this.data.highlights.colors.find((color) => color.id === highlight.id);
      if (
        !color ||
        !view.visibleRanges.some((range) => highlight.from < range.to && highlight.to > range.from)
      )
        continue;
      ranges.push(
        Decoration.mark({
          attributes: {
            'data-annotate-highlight': color.id,
            style: highlightStyle(color.value, this.data.highlights.shape),
          },
        }).range(highlight.from, highlight.to),
      );
    }
    for (const thread of this.data.threads) {
      const a = thread.anchor;
      if (thread.path !== path || thread.resolved || a.orphaned || a.to > view.state.doc.length)
        continue;
      if (!view.visibleRanges.some((range) => a.from < range.to && a.to > range.from)) continue;
      ranges.push(
        Decoration.mark({
          class: this.highlightClass(thread),
          attributes: { 'data-annotate-thread': thread.id },
        }).range(a.from, a.to),
      );
      ranges.push(
        Decoration.widget({ widget: new CountWidget(this, thread), side: 1 }).range(a.to),
      );
    }
    const draft = this.draft;
    if (draft?.view === view && draft.target.path === path) {
      const { from, to } = draft.target.anchor;
      if (from < to && to <= view.state.doc.length)
        ranges.push(Decoration.mark({ class: 'annotate-draft-selection' }).range(from, to));
    }
    this.highlightTagDecorations(view).between(0, view.state.doc.length, (from, to, value) => {
      ranges.push(value.range(from, to));
    });
    return Decoration.set(ranges, true);
  }
  refreshViews(exclude?: EditorView): void {
    if (!exclude) {
      if (this.refreshPending) return;
      this.refreshPending = true;
    }
    window.requestAnimationFrame(() => {
      if (!exclude) this.refreshPending = false;
      if (this.disposed) return;
      for (const view of this.views)
        if (view !== exclude) view.dispatch({ effects: refresh.of(null) });
      for (const section of this.readingSections.values()) {
        section.dirty = true;
        if (section.root.isShown()) this.renderReadingSection(section);
      }
    });
  }
  changed(): void {
    this.scheduleSave();
    this.refreshViews();
  }
  scheduleSave(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, 300);
  }
  persist(): Promise<void> {
    return this.persistOrThrow().catch(() => {});
  }
  onExternalSettingsChange(): Promise<void> {
    return this.queueStorage(async () => {
      if (!this.disposed && this.storageHealthy) await this.checkExternalData();
    }).catch(() => {});
  }
  private recoverConversations(data: PluginData): void {
    if (data.agent.consentVersion < 1) {
      data.codex.enabled = false;
      data.agent = { folders: [], webSearch: false, services: [], consentVersion: 1 };
      for (const thread of data.threads) if (thread.codex) thread.codex.sessionId = undefined;
      new Notice(
        'Annotate: assistant access now uses approved note folders. Review the sharing information in settings before enabling AI again.',
        10000,
      );
    }
    for (const thread of data.threads)
      if (thread.codex && ['pending', 'streaming'].includes(thread.codex.status)) {
        const interrupted = thread.comments.find((c) => c.id === thread.codex?.turnMessageId);
        if (interrupted) interrupted.status = 'unknown';
        thread.codex.status = 'unknown';
        thread.codex.error = 'Obsidian closed during this response. It will not be resent.';
      }
    for (const thread of data.threads)
      if (thread.codex && thread.codex.contextVersion !== 2) {
        thread.codex.sessionId = undefined;
        thread.codex.contextVersion = 2;
        if (!['unknown', 'unavailable'].includes(thread.codex.status)) thread.codex.status = 'idle';
      }
  }
  private async preserveConflict(external: unknown): Promise<never> {
    const directory = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/annotate`;
    const revision = JSON.stringify(external ?? null);
    const path =
      this.conflictBackups.get(revision) ??
      `${directory}/conflict-${Date.now()}-${crypto.randomUUID()}.json`;
    this.conflictBackups.set(revision, path);
    this.conflictBackup ??= path;
    await this.app.vault.adapter.write(
      path,
      JSON.stringify({ savedAt: Date.now(), local: this.data, external }, null, 2),
    );
    if (!this.conflictNotified) {
      this.conflictNotified = true;
      new Notice(
        `Annotate: synced data conflicts with local changes. Copies are preserved in conflict-*.json files in ${directory}. Saves are paused. Reload Annotate to load synced data.`,
        0,
      );
    }
    throw new StorageConflict('Synced data changed; local changes were preserved for recovery.');
  }
  private async checkExternalData(): Promise<boolean> {
    const raw: unknown = await this.loadData();
    const parsed = dataSchema.safeParse(raw ?? emptyData());
    if (this.conflictBackup || !parsed.success) return this.preserveConflict(raw);
    const external = parsed.data;
    const fingerprint = JSON.stringify(external);
    if (fingerprint === this.storedData) return false;
    if (
      dataFingerprint(this.data) !== this.storedData ||
      this.data.threads.some((thread) => this.threadBusy(thread))
    )
      return this.preserveConflict(raw);
    // Do not dismiss an open composer or an unsaved message edit for a sync update.
    if (this.popup && !this.disposed) return true;
    this.closePopup();
    this.hideSelectionTools();
    this.data = external;
    this.storedData = fingerprint;
    if (this.disposed) return true;
    this.recoverConversations(this.data);
    this.scheduleSave();
    for (const [path, text] of this.documents) this.reconcile(path, text);
    this.configureCodex();
    this.refreshHighlightStyles();
    this.refreshViews();
    if (this.settingsTab?.containerEl?.isShown()) this.settingsTab.update();
    return true;
  }
  private persistOrThrow(): Promise<void> {
    return this.queueStorage(async () => {
      if (!this.storageHealthy) throw new Error('Saved Annotate data is invalid.');
      if (await this.checkExternalData()) return;
      const snapshot = structuredClone(this.data);
      await this.saveData(snapshot);
      this.storedData = dataFingerprint(snapshot);
    });
  }
  private queueStorage(action: () => Promise<void>): Promise<void> {
    const write = this.saveQueue.then(action);
    this.saveQueue = write.catch((error) => {
      if (error instanceof StorageConflict) return;
      console.error('Annotate: unable to save', error);
      new Notice('Annotate could not save comments. Check vault storage and try again.');
    });
    return write;
  }
  closePopup(): void {
    this.quoteReply = null;
    this.markdown.clear();
    this.disposePopup?.();
    this.disposePopup = null;
    const panel = this.popup;
    this.popup = null;
    if (panel) {
      panel.classList.remove('annotate-popover');
      panel.classList.add('annotate-is-closing');
      panel.inert = true;
      panel.setAttribute('aria-hidden', 'true');
      this.retiring.add(panel);
      uiDelay(panel.ownerDocument, () => this.retire(panel), 140);
    }
    const wasOpen = this.openThreadId !== null;
    this.openThreadId = null;
    if (this.draft || wasOpen) {
      this.draft = null;
      this.refreshViews();
    }
    if (panel && !this.disposed) void this.onExternalSettingsChange();
  }
  private retire(panel: HTMLElement): void {
    panel.remove();
    this.retiring.delete(panel);
  }
  /** Shows one transient notice with an Undo action; a newer notice replaces it. */
  showUndo(doc: Document, message: string, undo: () => void): void {
    this.dismissToast(true);
    const element = doc.win.createDiv(),
      text = doc.win.createSpan(),
      button = doc.win.createEl('button');
    element.className = 'annotate-toast';
    element.setAttribute('role', 'status');
    text.textContent = message;
    button.type = 'button';
    button.className = 'annotate-toast-undo';
    button.textContent = 'Undo';
    button.addEventListener('click', () => {
      this.dismissToast();
      undo();
    });
    element.append(text, button);
    doc.body.append(element);
    const toast: NonNullable<typeof this.toast> = { element };
    const arm = (ms: number) => {
      toast.timer?.();
      toast.timer = uiDelay(
        doc,
        () => {
          if (this.toast === toast) this.dismissToast();
        },
        ms,
      );
    };
    element.addEventListener('mouseenter', () => toast.timer?.());
    element.addEventListener('mouseleave', () => arm(2500));
    this.toast = toast;
    arm(6000);
  }
  dismissToast(immediate = false): void {
    const toast = this.toast;
    this.toast = null;
    if (!toast) return;
    toast.timer?.();
    if (immediate) toast.element.remove();
    else {
      toast.element.classList.add('annotate-is-closing');
      uiDelay(toast.element.ownerDocument, () => toast.element.remove(), 160);
    }
  }
  /** Scrolls a thread's highlight into view, pulses it once, and opens the thread there. */
  revealThread(thread: Thread): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== thread.path || thread.resolved || thread.anchor.orphaned) {
      this.openThread(thread);
      return;
    }
    this.pulseTimer?.();
    this.pulseId = thread.id;
    this.pulseTimer = uiDelay(
      view.containerEl.ownerDocument,
      () => {
        this.pulseId = null;
        this.refreshViews();
      },
      1400,
    );
    const doc = view.containerEl.ownerDocument;
    const mark = () =>
      view.containerEl.querySelector<HTMLElement>(
        `[data-annotate-thread="${CSS.escape(thread.id)}"]`,
      );
    if (view.getMode() === 'source') {
      const editor = view.editor;
      editor.scrollIntoView(
        { from: editor.offsetToPos(thread.anchor.from), to: editor.offsetToPos(thread.anchor.to) },
        true,
      );
    } else mark()?.scrollIntoView({ block: 'center' });
    this.refreshViews();
    uiDelay(
      doc,
      () => {
        if (this.disposed || !this.data.threads.includes(thread)) return;
        const rect = mark()?.getBoundingClientRect();
        this.openThread(thread, rect && rect.height ? rect : undefined, doc);
      },
      90,
    );
  }
  private panel(rect?: Pick<DOMRect, 'left' | 'bottom'>, doc: Document = document): HTMLElement {
    this.hideSelectionTools();
    this.closePopup();
    for (const old of [...this.retiring]) this.retire(old);
    const panel = doc.win.createEl('section');
    panel.className = 'annotate-popover annotate-panel';
    panel.setAttribute('role', 'dialog');
    const title = doc.win.createSpan();
    title.id = `annotate-thread-label-${crypto.randomUUID()}`;
    title.hidden = true;
    title.textContent = 'Comment thread';
    panel.setAttribute('aria-labelledby', title.id);
    panel.append(title);
    const header = doc.win.createEl('header');
    header.className = 'annotate-header';
    const close = iconButton(doc, 'x', 'Close comments', 'annotate-close');
    close.addEventListener('click', () => this.closePopup());
    header.append(close);
    panel.append(header);
    doc.body.append(panel);
    this.popup = panel;
    const outside = (event: MouseEvent) => {
      if (panel.classList.contains('annotate-fullscreen')) return;
      if (event.targetNode && !panel.contains(event.targetNode)) this.closePopup();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (panel.classList.contains('annotate-fullscreen')) this.setFullscreen(panel, false);
        else this.closePopup();
      }
    };
    let selectedBody: HTMLElement | null = null;
    const captureSelection = () => {
      const selection = doc.getSelection();
      const anchor = selection?.anchorNode;
      const element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
      const body = element?.instanceOf(Element)
        ? element.closest<HTMLElement>('.annotate-message-body')
        : null;
      const next = body && panel.contains(body) ? body : null;
      if (selectedBody && selectedBody !== next) this.selectionHandlers.get(selectedBody)?.();
      if (next) this.selectionHandlers.get(next)?.();
      selectedBody = next;
    };
    doc.addEventListener('selectionchange', captureSelection);
    panel.addEventListener('mouseup', captureSelection);
    panel.addEventListener('keyup', captureSelection);
    doc.addEventListener('mousedown', outside);
    doc.addEventListener('keydown', escape);
    const win = doc.defaultView,
      Observer = win?.ResizeObserver;
    const resize = Observer
      ? new Observer(() => {
          if (this.popup === panel) this.position(panel, this.anchorRect, doc);
        })
      : null;
    resize?.observe(panel);
    this.disposePopup = () => {
      doc.removeEventListener('selectionchange', captureSelection);
      doc.removeEventListener('mousedown', outside);
      doc.removeEventListener('keydown', escape);
      resize?.disconnect();
    };
    this.position(panel, rect, doc);
    return panel;
  }
  private anchorRect: Pick<DOMRect, 'left' | 'bottom'> | undefined;
  private position(
    element: HTMLElement,
    rect: Pick<DOMRect, 'left' | 'bottom'> | undefined,
    doc: Document,
  ): void {
    this.anchorRect = rect;
    if (element.classList.contains('annotate-fullscreen')) {
      element.style.removeProperty('left');
      element.style.removeProperty('top');
      return;
    }
    const win = doc.defaultView;
    if (!win) return;
    const bounds = element.getBoundingClientRect();
    element.setCssStyles({
      left: `${Math.max(12, Math.min(rect?.left ?? (win.innerWidth - bounds.width) / 2, win.innerWidth - bounds.width - 12))}px`,
    });
    element.setCssStyles({
      top: `${Math.max(12, Math.min((rect?.bottom ?? 100) + 10, win.innerHeight - bounds.height - 12))}px`,
    });
  }
  private quote(panel: HTMLElement, anchor: Anchor): void {
    const quote = panel.ownerDocument.win.createEl('blockquote');
    quote.className = 'annotate-quote';
    quote.textContent = anchor.quote;
    const header = panel.querySelector('.annotate-header');
    if (header) header.prepend(quote);
    else panel.append(quote);
    if (anchor.orphaned) {
      const warning = panel.ownerDocument.win.createEl('p');
      warning.className = 'annotate-muted annotate-orphaned';
      warning.textContent =
        'The original text was removed or cannot be located uniquely. The comments are preserved.';
      panel.append(warning);
    }
  }
  private composer(
    panel: HTMLElement,
    label: string,
    submit: (body: string, quote?: ReplyQuote) => Promise<boolean>,
    allowQuote = false,
    draftKey?: string,
    notePath?: string,
  ): void {
    const doc = panel.ownerDocument,
      form = doc.win.createEl('form'),
      input = doc.win.createEl('textarea'),
      button = doc.win.createEl('button');
    form.className = 'annotate-composer';
    const context = doc.win.createEl('p');
    context.className = 'annotate-context-preview';
    context.textContent = `AI context: complete note ${notePath ?? ''}, selected passage, and earlier thread messages. @comment saves locally without starting a request; it can enter later AI context.`;
    context.hidden = true;
    panel.append(context);
    input.placeholder = label;
    const inputLabel = doc.win.createEl('label');
    input.id = `annotate-composer-${crypto.randomUUID()}`;
    inputLabel.htmlFor = input.id;
    inputLabel.hidden = true;
    inputLabel.textContent = label;
    input.rows = 1;
    const avatar = doc.win.createSpan();
    avatar.className = 'annotate-avatar';
    avatar.textContent = initial(this.data.author || 'You');
    avatar.setAttribute('aria-hidden', 'true');
    button.type = 'submit';
    button.append(icon(doc, 'up'));
    button.setAttribute('aria-label', 'Send comment');
    button.title = 'Save comment (Enter); new line (Shift+Enter)';
    button.className = 'annotate-send';
    button.disabled = true;
    const sync = () => {
      button.disabled = !input.value.trim();
      form.classList.toggle('annotate-has-text', !button.disabled);
      let asking: ReturnType<typeof assistantInvocation> = null;
      try {
        asking = assistantInvocation(
          input.value,
          this.data.codex.enabled ? this.data.assistant.provider : undefined,
        );
      } catch {
        // Submission reports conflicting assistant mentions.
      }
      form.classList.toggle('annotate-asking-ai', asking !== null);
      context.hidden = asking === null;
      button.setAttribute(
        'aria-label',
        asking ? `Ask ${providers[asking.provider].name}` : 'Send comment',
      );
      button.title = `${asking ? 'Ask assistant' : 'Save comment'} (Enter); new line (Shift+Enter)`;
      // Measure at auto height, then restore the old height first so the change can transition.
      const previous = input.style.height;
      input.setCssStyles({ height: 'auto' });
      const next = `${Math.min(160, Math.max(24, input.scrollHeight))}px`;
      input.setCssStyles({ height: previous });
      void input.offsetHeight;
      input.setCssStyles({ height: next });
    };
    input.addEventListener('input', () => {
      sync();
      if (!draftKey) return;
      if (input.value.trim()) this.drafts.set(draftKey, input.value);
      else this.drafts.delete(draftKey);
    });
    const inputContainer = doc.win.createDiv();
    inputContainer.className = 'annotate-composer-input';
    let replyQuote: ReplyQuote | undefined;
    const preview = doc.win.createDiv();
    preview.className = 'annotate-reply-preview';
    preview.hidden = true;
    const quoted = doc.win.createEl('blockquote');
    quoted.className = 'annotate-reply-quote';
    const clearQuote = iconButton(doc, 'x', 'Remove quote');
    preview.append(quoted, clearQuote);
    const clearReply = () => {
      replyQuote = undefined;
      preview.hidden = true;
      quoted.textContent = '';
    };
    clearQuote.addEventListener('click', () => {
      clearReply();
      input.focus({ preventScroll: true });
    });
    if (allowQuote)
      this.quoteReply = (quote) => {
        if (pending) return;
        replyQuote = quote;
        quoted.textContent = quote.text;
        quoted.title = quote.text;
        preview.hidden = false;
        input.focus({ preventScroll: true });
      };
    const hint = doc.win.createDiv();
    hint.className = 'annotate-composer-hint';
    hint.setAttribute('aria-hidden', 'true');
    const key = (text: string) => {
      const element = doc.win.createEl('kbd');
      element.textContent = text;
      return element;
    };
    const hintInner = doc.win.createSpan();
    hintInner.append(
      key('↵'),
      doc.createTextNode(' to send'),
      doc.createTextNode('  ·  '),
      key('⇧ ↵'),
      doc.createTextNode(' new line'),
    );
    hint.append(hintInner);
    inputContainer.append(preview, input, hint);
    mentionMenu(input, inputContainer, this.data.assistant.provider, () => this.loadSkills());
    form.append(inputLabel, avatar, inputContainer, button);
    panel.append(form);
    let pending = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (pending || !input.value.trim()) return;
      pending = true;
      button.disabled = true;
      void submit(input.value.trim(), replyQuote)
        .then((success) => {
          if (success) {
            clearReply();
            if (draftKey) this.drafts.delete(draftKey);
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })
        .catch(
          (error) =>
            new Notice(error instanceof Error ? error.message : 'Unable to submit comment.'),
        )
        .finally(() => {
          pending = false;
          button.disabled = !input.value.trim();
        });
    });
    input.addEventListener('keydown', (event) => {
      // Preserve the legacy IME guard when compositionend precedes the confirming Enter.
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        event.stopPropagation();
        form.requestSubmit();
      }
    });
    const saved = draftKey ? this.drafts.get(draftKey) : undefined;
    if (saved) {
      input.value = saved;
      input.setSelectionRange(saved.length, saved.length);
    }
    sync();
    input.focus({ preventScroll: true });
  }
  compose(target: Target, rect?: Pick<DOMRect, 'left' | 'bottom'>, doc?: Document): void {
    const view =
      target.kind === 'reading'
        ? null
        : ([...this.views].find((view) => {
            const selection = view.state.selection.main;
            return (
              view.state.field(editorInfoField, false)?.file?.path === target.path &&
              selection.from === target.anchor.from &&
              selection.to === target.anchor.to
            );
          }) ?? null);
    if (!rect && view) {
      const start = view.coordsAtPos(target.anchor.from, 1);
      const end = view.coordsAtPos(target.anchor.to, -1);
      if (start && end) rect = { left: start.left, bottom: end.bottom };
    }
    doc ??= view?.dom.ownerDocument;
    const panel = this.panel(rect, doc);
    panel.classList.add('annotate-new-comment');
    this.quote(panel, target.anchor);
    this.draft = { target, view };
    this.refreshViews();
    this.composer(
      panel,
      this.data.codex.enabled
        ? `Ask @${this.data.assistant.provider}, or @comment to comment…`
        : 'Add a comment…',
      async (body) => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (file?.path !== target.path) {
          new Notice('Return to the selected note before adding the comment.');
          return false;
        }
        const anchor = locateAnchor(target.anchor, await target.text());
        if (anchor.orphaned) {
          new Notice('The selection changed. Select the text again to comment.');
          return false;
        }
        const thread: Thread = {
          id: crypto.randomUUID(),
          path: target.path,
          anchor,
          resolved: false,
          comments: [],
        };
        this.data.threads.push(thread);
        try {
          if (!(await this.record(thread, body))) {
            this.data.threads = this.data.threads.filter((t) => t !== thread);
            return false;
          }
        } catch (error) {
          this.data.threads = this.data.threads.filter((t) => t !== thread);
          throw error;
        }
        if (!this.disposed && this.data.threads.includes(thread))
          this.openThread(thread, rect, panel.ownerDocument);
        return true;
      },
      false,
      `new:${target.path}:${target.anchor.from}:${target.anchor.to}`,
      target.path,
    );
    this.position(panel, rect, panel.ownerDocument);
  }
  openThread(thread: Thread, rect?: Pick<DOMRect, 'left' | 'bottom'>, doc?: Document): void {
    const fullscreen =
      this.openThreadId === thread.id && !!this.popup?.classList.contains('annotate-fullscreen');
    const panel = this.panel(rect, doc),
      owner = panel.ownerDocument;
    this.quote(panel, thread.anchor);
    const list = owner.win.createDiv();
    list.className = 'annotate-messages';
    panel.append(list);
    this.openThreadId = thread.id;
    this.refreshViews();
    for (const comment of thread.comments) this.messageElement(list, thread, comment);
    const header = panel.querySelector('.annotate-header'),
      close = header?.querySelector('.annotate-close');
    const actions = owner.win.createDiv();
    actions.className = 'annotate-actions';
    header?.insertBefore(actions, close ?? null);
    actions.append(
      copyButton(owner, 'Copy entire thread', () => threadText(thread), 'annotate-copy-thread'),
    );
    const expand = iconButton(owner, 'expand', 'Expand thread', 'annotate-expand');
    expand.setAttribute('aria-pressed', 'false');
    expand.addEventListener('click', () =>
      this.setFullscreen(panel, !panel.classList.contains('annotate-fullscreen')),
    );
    actions.append(expand);
    const resolve = iconButton(
      owner,
      thread.resolved ? 'undo' : 'check',
      thread.resolved ? 'Re-open thread' : 'Resolve thread',
      'annotate-resolve',
    );
    actions.append(resolve);
    resolve.addEventListener('click', () => {
      thread.resolved = !thread.resolved;
      this.changed();
      this.openThread(thread, rect, owner);
    });
    const remove = iconButton(owner, 'trash', 'Delete thread', 'annotate-delete');
    actions.append(remove);
    remove.addEventListener('click', () => {
      this.contextRequests.get(thread.id)?.abort();
      if (thread.codex?.sessionId)
        void this.backend?.interrupt(thread.codex.sessionId).catch(() => {});
      const index = this.data.threads.indexOf(thread);
      this.data.threads = this.data.threads.filter((t) => t.id !== thread.id);
      this.changed();
      this.closePopup();
      this.showUndo(owner, 'Thread deleted', () => {
        if (this.data.threads.includes(thread)) return;
        if (thread.codex && thinking(thread.codex.status)) thread.codex.status = 'cancelled';
        for (const message of thread.comments)
          if (thinking(message.status)) message.status = 'cancelled';
        this.data.threads.splice(Math.min(index, this.data.threads.length), 0, thread);
        this.changed();
        void this.persist();
      });
    });
    if (thread.resolved) {
      const banner = owner.win.createDiv();
      banner.className = 'annotate-resolved-banner';
      banner.append(icon(owner, 'check'), owner.createTextNode('Resolved'));
      panel.insertBefore(banner, list);
    }
    if (this.data.codex.enabled || thread.codex) {
      const bar = owner.win.createDiv();
      bar.className = 'annotate-ai-bar';
      panel.append(bar);
      const status = owner.win.createEl('p');
      status.className = 'annotate-codex-status';
      status.setAttribute('role', 'status');
      bar.append(status);
      const cancel = owner.win.createEl('button');
      cancel.type = 'button';
      cancel.className = 'annotate-pill annotate-codex-cancel';
      cancel.append(icon(owner, 'stop'), owner.createTextNode('Stop'));
      bar.append(cancel);
      cancel.addEventListener('click', () => {
        this.cancellations.add(thread.id);
        this.contextRequests.get(thread.id)?.abort();
        if (thread.codex?.sessionId)
          void this.backend
            ?.interrupt(thread.codex.sessionId)
            .catch((error) => new Notice(String(error)));
      });
      const reconnect = owner.win.createEl('button');
      reconnect.type = 'button';
      reconnect.className = 'annotate-pill annotate-codex-reconnect';
      reconnect.append(icon(owner, 'refresh'), owner.createTextNode('Reconnect'));
      bar.append(reconnect);
      reconnect.addEventListener('click', () => {
        if (this.backend) void this.backend.connect().catch(() => this.paintCodex());
        else this.configureCodex();
      });
      const reset = owner.win.createEl('button');
      reset.type = 'button';
      reset.className = 'annotate-pill annotate-codex-reset';
      reset.append(icon(owner, 'sparkle'), owner.createTextNode('Start new conversation'));
      bar.append(reset);
      reset.addEventListener('click', () => {
        if (!['unknown', 'unavailable'].includes(thread.codex?.status ?? '')) return;
        thread.codex = { status: 'idle' };
        this.changed();
        this.paintCodex();
      });
    }
    if (!thread.resolved)
      this.composer(
        panel,
        this.data.codex.enabled
          ? `Ask @${this.data.assistant.provider}, or @comment to comment…`
          : 'Reply…',
        async (body, quote) => {
          if (!this.data.threads.includes(thread)) return false;
          if (!(await this.record(thread, body, quote))) return false;
          if (!this.disposed && this.data.threads.includes(thread)) this.paintCodex();
          return true;
        },
        true,
        `thread:${thread.id}`,
        thread.path,
      );
    this.paintCodex();
    list.scrollTop = list.scrollHeight;
    this.position(panel, rect, owner);
    if (fullscreen) this.setFullscreen(panel, true);
  }
  private setFullscreen(panel: HTMLElement, expanded: boolean): void {
    const list = panel.querySelector<HTMLElement>('.annotate-messages');
    const scroll = list?.scrollTop;
    panel.classList.toggle('annotate-fullscreen', expanded);
    const button = panel.querySelector<HTMLButtonElement>('.annotate-expand');
    if (button) {
      const label = expanded ? 'Restore thread size' : 'Expand thread';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(expanded));
      button.title = label;
      button.replaceChildren(icon(panel.ownerDocument, expanded ? 'shrink' : 'expand'));
    }
    this.position(panel, this.anchorRect, panel.ownerDocument);
    if (list && scroll !== undefined) list.scrollTop = scroll;
  }
}

class ThreadList extends Modal {
  constructor(private plugin: Annotate) {
    super(plugin.app);
  }
  onOpen(): void {
    const path = this.app.workspace.getActiveFile()?.path;
    this.modalEl.addClass('annotate-thread-modal');
    this.titleEl.setText('Comments');
    this.titleEl.addClass('annotate-brand-heading');
    this.titleEl.prepend(pluginLogo(this.titleEl.ownerDocument));
    const threads = this.plugin.data.threads
      .filter((t) => t.path === path)
      .sort((x, y) => Number(x.resolved) - Number(y.resolved));
    if (!threads.length)
      this.contentEl.createEl('p', {
        cls: 'annotate-empty',
        text: `No comments yet. Select text, then ${commandShortcut(this.plugin.app, 'annotate:add-selection-comment') ? `press ${commandShortcut(this.plugin.app, 'annotate:add-selection-comment')}` : 'run Comment on selection from the command palette'}.`,
      });
    for (const thread of threads) {
      const row = this.contentEl.createDiv({
        cls: `annotate-thread-row${thread.resolved ? ' annotate-is-resolved' : ''}`,
      });
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open comment thread: ${thread.anchor.quote}`);
      const openRow = () => {
        this.close();
        this.plugin.revealThread(thread);
      };
      row.addEventListener('click', (event) => {
        if (event.targetNode?.instanceOf(Element) && event.targetNode.closest('button')) return;
        openRow();
      });
      row.addEventListener('keydown', (event) => {
        if (event.target !== row) return;
        const rows = [...this.contentEl.querySelectorAll<HTMLElement>('.annotate-thread-row')];
        const at = rows.indexOf(row);
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openRow();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
        }
      });
      row.createEl('blockquote', { text: thread.anchor.quote });
      const first = thread.comments[0],
        last = thread.comments.at(-1);
      if (first) {
        const preview = row.createDiv({ cls: 'annotate-thread-preview' });
        preview.createSpan({ cls: 'annotate-avatar', text: initial(first.author) });
        preview.createEl('strong', { text: first.author });
        preview.createSpan({ cls: 'annotate-thread-snippet', text: first.body });
      }
      row.createEl('p', {
        text: `${thread.comments.length} ${thread.comments.length === 1 ? 'comment' : 'comments'}${last ? ' · ' + relativeTime(last.createdAt) : ''}${thread.resolved ? ' · Resolved' : ''}${thread.anchor.orphaned ? ' · Text missing' : ''}`,
      });
      const open = row.createEl('button', { text: 'Open', cls: 'annotate-pill' });
      open.tabIndex = -1;
      open.addEventListener('click', openRow);
      if (thread.anchor.orphaned) {
        const reattach = row.createEl('button', {
          text: 'Attach to selection',
          cls: 'annotate-pill',
        });
        reattach.addEventListener('click', () => {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view?.file?.path !== thread.path || !view.editor.getSelection().trim()) {
            new Notice('Select replacement text in this note before opening the comments list.');
            return;
          }
          thread.anchor = makeAnchor(
            view.editor.getValue(),
            view.editor.posToOffset(view.editor.getCursor('from')),
            view.editor.posToOffset(view.editor.getCursor('to')),
          );
          this.plugin.changed();
          this.close();
          this.plugin.revealThread(thread);
        });
      }
    }
    this.contentEl.querySelector<HTMLElement>('.annotate-thread-row')?.focus();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
class CommentsSettings extends PluginSettingTab {
  private disposeShortcuts: (() => void) | null = null;
  constructor(private plugin: Annotate) {
    super(plugin.app, plugin);
  }
  getSettingDefinitions(): SettingDefinitionItem[] {
    // Render callbacks retain Annotate's combined comments/settings storage and side effects.
    const definitions: SettingDefinitionItem[] = [
      {
        name: 'Annotate',
        searchable: false,
        render: (setting) => {
          this.containerEl.addClass('annotate-settings');
          setting.setHeading().setClass('annotate-brand-heading');
          setting.nameEl.prepend(pluginLogo(this.containerEl.ownerDocument));
          if (typeof ANNOTATE_DEVELOPMENT !== 'undefined' && ANNOTATE_DEVELOPMENT)
            setting.setDesc('Development · automatic local updates enabled');
        },
      },
    ];
    definitions.push({
      name: 'Your name',
      desc: 'Shown on comments you write.',
      render: (setting) => {
        setting.setDesc('Shown on comments you write.').addText((text) =>
          text
            .setPlaceholder('Name')
            .setValue(this.plugin.data.author)
            .onChange((value) => {
              this.plugin.data.author = value;
              this.plugin.changed();
            }),
        );
      },
    });
    const provider = this.plugin.data.assistant.provider;
    definitions.push({
      name: 'Ask AI in comments',
      render: (setting) => {
        setting
          .setDesc(
            'AI requests send the complete current note, selected passage, question, and prior thread messages to the selected assistant’s model provider. Earlier @comment messages may be included later. Review folder access below. Start with @comment to save without starting a request.',
          )
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.data.codex.enabled).onChange((value) => {
              this.plugin.data.codex.enabled = value;
              this.plugin.changed();
              this.plugin.configureCodex();
            }),
          );
      },
    });
    definitions.push({
      name: 'Default assistant',
      render: (setting) => {
        setting
          .setDesc(`Receives messages by default. Currently @${provider}.`)
          .addDropdown((dropdown) => {
            for (const [id, entry] of Object.entries(providers)) dropdown.addOption(id, entry.name);
            dropdown.setValue(provider).onChange((value) => {
              this.plugin.data.assistant.provider = providerSchema.parse(value);
              this.plugin.changed();
              this.plugin.configureCodex();
              this.update();
            });
          });
      },
    });
    for (const id of providerSchema.options) {
      const name = providers[id].name;
      const login =
        id === 'chatgpt'
          ? 'codex login'
          : id === 'claude'
            ? 'claude auth login'
            : 'opencode auth login';
      const config = id === 'chatgpt' ? this.plugin.data.codex : this.plugin.data.assistant[id];
      const models = () => {
        const known =
          id === 'opencode'
            ? this.plugin.opencodeModels
            : id === 'claude'
              ? claudeModels
              : Object.keys(this.plugin.chatgptModels).length
                ? this.plugin.chatgptModels
                : cachedChatgptModels();
        const labels: Record<string, string> = { ...known };
        if (config.model && !labels[config.model]) labels[config.model] = config.model;
        return labels;
      };
      let fillModels = () => {};
      let refreshOthers = () => {};
      const selectModel = (value: string) => {
        config.model = value;
        this.plugin.changed();
        if (this.plugin.data.codex.enabled && id === this.plugin.data.assistant.provider)
          this.plugin.configureCodex();
        fillModels();
      };
      definitions.push({
        name,
        aliases: [`${name} model`, `${name} connection`],
        render: (row) => {
          row.addDropdown((dropdown) => {
            fillModels = () => {
              dropdown.selectEl.empty();
              const labels =
                id === 'opencode' ? featuredModelLabels(models(), config.model) : models();
              const options = Object.keys(labels);
              for (const model of options) dropdown.addOption(model, labels[model] ?? model);
              dropdown.selectEl.toggle(options.length > 0);
              dropdown.setValue(config.model || options[0] || '');
              refreshOthers();
            };
            fillModels();
            dropdown.selectEl.addClass('annotate-settings-model');
            dropdown.selectEl.setAttribute('aria-label', `${name} model`);
            dropdown.onChange(selectModel);
          });
          row.addButton((button) =>
            button.setButtonText('Check').onClick(async () => {
              button.setDisabled(true).setButtonText('Checking…');
              const connected = await this.plugin.checkConnection(id);
              if (
                connected &&
                this.plugin.data.codex.enabled &&
                id === this.plugin.data.assistant.provider &&
                this.plugin.backend?.state !== 'ready'
              )
                this.plugin.configureCodex();
              fillModels();
              button.setDisabled(false).setButtonText(connected ? 'Connected' : 'Retry');
            }),
          );
          if (id === 'opencode') {
            const others = row.descEl.createDiv({ cls: 'annotate-other-models' });
            others.hidden = true;
            others.id = `annotate-other-models-${crypto.randomUUID()}`;
            let othersButton: HTMLButtonElement | undefined;
            const picker = createOtherModelPicker({
              container: others,
              labels: models,
              pricing: () => this.plugin.opencodeModelPricing,
              onChoose: (value) => {
                selectModel(value);
                others.hidden = true;
                othersButton?.setAttribute('aria-expanded', 'false');
                othersButton?.focus();
              },
            });
            refreshOthers = picker.refresh;
            row.addButton((button) => {
              othersButton = button.buttonEl;
              button.buttonEl.setAttribute('aria-expanded', 'false');
              button.buttonEl.setAttribute('aria-controls', others.id);
              button.setButtonText('Others').onClick(() => {
                others.hidden = !others.hidden;
                button.buttonEl.setAttribute('aria-expanded', String(!others.hidden));
                if (!others.hidden) {
                  picker.refresh();
                  picker.focus();
                }
              });
            });
          }
          row.settingEl.addClass('annotate-settings-provider');
          const connection = row.descEl.createDiv({ cls: 'annotate-settings-codex-status' });
          connection.dataset.provider = id;
          connection.setAttribute('role', 'status');
          this.plugin.connectionLabels.set(id, connection);
          row.descEl.createDiv({
            cls: 'annotate-settings-hint',
            text:
              id === 'opencode'
                ? 'Check to refresh models. Find additional models in Others.'
                : `Not connected? Run ${login} in Terminal, then Check.`,
          });
          this.plugin.paintConnections();
          return () => {
            if (this.plugin.connectionLabels.get(id) === connection)
              this.plugin.connectionLabels.delete(id);
          };
        },
      });
    }
    definitions.push({
      type: 'group',
      heading: 'Assistant access',
      cls: 'annotate-agent-settings',
      items: this.plugin.agentAccess.getSettingDefinitions(() => this.update()),
    });
    const advanced: SettingDefinition[] = [
      {
        name: 'Keyboard shortcuts',
        render: (setting) => {
          this.disposeShortcuts?.();
          setting.settingEl.addClass('annotate-hotkey-settings');
          setting.infoEl.remove();
          const root = setting.settingEl.createDiv();
          const dispose = renderShortcutSettings(root, this.plugin.app);
          this.disposeShortcuts = dispose;
          return () => {
            dispose();
            root.remove();
            if (this.disposeShortcuts === dispose) this.disposeShortcuts = null;
          };
        },
      },
    ];
    advanced.push({
      name: 'Highlight shape',
      render: (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOptions(highlightShapes)
            .setValue(this.plugin.data.highlights.shape)
            .onChange((value) => {
              if (value !== 'rounded' && value !== 'flat' && value !== 'underline') return;
              this.plugin.data.highlights.shape = value;
              this.plugin.refreshHighlightStyles();
              this.plugin.changed();
            }),
        );
      },
    });
    for (const [index, color] of this.plugin.data.highlights.colors.entries()) {
      let hexInput: HTMLInputElement | undefined;
      advanced.push({
        name: `Highlight color ${index + 1}: ${color.name}`,
        aliases: [color.name, 'Highlight color'],
        render: (setting) => {
          setting
            .setName('Highlight color')
            .setClass('annotate-settings-highlight-color')
            .addText((text) =>
              text
                .setPlaceholder('Color name')
                .setValue(color.name)
                .onChange((value) => {
                  if (!value.trim()) return;
                  color.name = value.trim();
                  this.plugin.changed();
                }),
            )
            .addColorPicker((picker) => {
              picker.setValue(color.value.slice(0, 7)).onChange((value) => {
                color.value = value + color.value.slice(7);
                if (hexInput) hexInput.value = color.value;
                this.plugin.refreshHighlightStyles();
                this.plugin.changed();
              });
            })
            .addText((text) => {
              hexInput = text.inputEl;
              text
                .setPlaceholder('#rrggbb or #rrggbbaa')
                .setValue(color.value)
                .onChange((value) => {
                  const valid = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value.trim());
                  text.inputEl.setAttribute('aria-invalid', String(!valid));
                  if (!valid) return;
                  color.value = value.trim();
                  this.plugin.refreshHighlightStyles();
                  this.plugin.changed();
                });
              text.inputEl.setAttribute('aria-label', `${color.name} highlight color`);
            })
            .addButton((button) =>
              button
                .setButtonText('Remove')
                .setDisabled(this.plugin.data.highlights.colors.length === 1)
                .onClick(() => {
                  this.plugin.data.highlights.colors = this.plugin.data.highlights.colors.filter(
                    (item) => item.id !== color.id,
                  );
                  this.plugin.data.highlights.recent = this.plugin.recentHighlight().id;
                  this.plugin.refreshHighlightStyles();
                  this.plugin.changed();
                  this.update();
                }),
            );
        },
      });
    }
    advanced.push({
      name: 'Highlight palette',
      render: (setting) => {
        setting
          .setDesc(
            'Hex colors accept optional opacity. Changes apply to existing Annotate highlights while enabled.',
          )
          .addButton((button) =>
            button
              .setButtonText('Add color')
              .setDisabled(this.plugin.data.highlights.colors.length >= 20)
              .onClick(() => {
                this.plugin.data.highlights.colors.push({
                  id: `color-${crypto.randomUUID()}`,
                  name: 'New color',
                  value: '#b8a3ff80',
                });
                this.plugin.refreshHighlightStyles();
                this.plugin.changed();
                this.update();
              }),
          );
      },
    });
    if (typeof ANNOTATE_DEVELOPMENT !== 'undefined' && ANNOTATE_DEVELOPMENT) {
      advanced.push({
        name: 'Local development build',
        render: (setting) => {
          setting
            .setDesc(
              'Successful local builds update automatically when comments and AI responses are idle. No Obsidian restart needed.',
            )
            .addButton((button) =>
              button
                .setButtonText('Sync')
                .setDisabled(this.plugin.syncing)
                .onClick(async () => {
                  button.setDisabled(true).setButtonText('Syncing…');
                  await this.plugin.syncBuild();
                  button.setDisabled(false).setButtonText('Sync');
                }),
            );
        },
      });
    }
    for (const id of providerSchema.options) {
      const config = id === 'chatgpt' ? this.plugin.data.codex : this.plugin.data.assistant[id];
      const command = providers[id].executable;
      advanced.push({
        name: `${providers[id].name} command`,
        render: (setting) => {
          setting
            .setDesc(`Found automatically. Set a full path only if Check can't find ${command}.`)
            .addText((text) =>
              text
                .setPlaceholder(command)
                .setValue(config.executable === command ? '' : config.executable)
                .onChange((value) => {
                  config.executable = value.trim() || command;
                  this.plugin.changed();
                }),
            );
        },
      });
    }
    definitions.push({
      type: 'group',
      heading: 'Advanced',
      cls: 'annotate-settings-advanced',
      items: advanced,
    });
    return definitions;
  }
  hide(): void {
    this.disposeShortcuts?.();
    this.disposeShortcuts = null;
    this.plugin.connectionLabels.clear();
    super.hide();
  }
}

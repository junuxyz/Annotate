import {
  CodexBackend,
  SessionUnavailable,
  OutcomeUnknown,
  invocation,
  questionContext,
  type ConversationMessage,
} from './codex';
import {
  MarkdownView,
  MarkdownRenderChild,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  setIcon,
  editorInfoField,
  type MarkdownPostProcessorContext,
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

import logoUrl from '../assets/annotate-logo.png';

function pluginLogo(doc: Document): HTMLImageElement {
  const image = doc.createElement('img');
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
} as const;
const OPENAI_MARK =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.066 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z';
function openaiIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('annotate-openai-icon');
  path.setAttribute('d', OPENAI_MARK);
  svg.append(path);
  return svg;
}
function icon(doc: Document, name: keyof typeof ICONS): HTMLElement {
  const element = doc.createElement('span');
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
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `annotate-icon-button ${cls}`.trim();
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(doc, name));
  return button;
}
function countBadge(doc: Document, thread: Thread): HTMLButtonElement {
  const button = doc.createElement('button'),
    count = doc.createElement('span');
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
const initial = (name: string) => (name.trim() || '?').slice(0, 1).toUpperCase();
const thinking = (status?: string) => status === 'pending' || status === 'streaming';
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
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private storageHealthy = true;
  backend: CodexBackend | null = null;
  connectionLabel: HTMLElement | null = null;
  private openThreadId: string | null = null;
  private quoteReply: ((quote: ReplyQuote) => void) | null = null;
  private markdown = new CommentMarkdown();
  private submissions = new Set<string>();
  private cancellations = new Set<string>();
  createBackend(): CodexBackend {
    return new CodexBackend(this.data.codex.executable, () => this.paintCodex());
  }
  configureCodex(): void {
    this.backend?.disable();
    this.backend = null;
    if (this.data.codex.enabled) {
      this.backend = this.createBackend();
      void this.backend.enable().catch(() => this.paintCodex());
    }
    this.paintCodex();
  }
  private messageElement(list: Element, thread: Thread, comment: Thread['comments'][number]): void {
    const owner = list.ownerDocument,
      item = owner.createElement('article'),
      heading = owner.createElement('div'),
      avatar = owner.createElement('span'),
      author = owner.createElement('strong'),
      time = owner.createElement('time'),
      body = owner.createElement('div');
    const ai = comment.role === 'assistant';
    item.dataset.messageId = comment.id;
    item.className = ai ? 'annotate-message annotate-message-ai' : 'annotate-message';
    avatar.className = ai ? 'annotate-avatar annotate-avatar-ai' : 'annotate-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (ai) avatar.append(openaiIcon(owner));
    else avatar.textContent = initial(comment.author);
    author.textContent = ai ? 'ChatGPT' : comment.author;
    time.dateTime = new Date(comment.createdAt).toISOString();
    time.textContent = relativeTime(comment.createdAt);
    time.title = new Date(comment.createdAt).toLocaleString();
    heading.className = 'annotate-message-heading';
    heading.append(avatar, author, time);
    const actions = owner.createElement('div');
    actions.className = 'annotate-message-actions';
    const edit = iconButton(owner, 'edit', 'Edit comment', 'annotate-message-edit');
    const remove = iconButton(owner, 'trash', 'Remove comment', 'annotate-message-remove');
    const reply = iconButton(owner, 'reply', 'Quote and reply', 'annotate-message-reply');
    reply.hidden = thread.resolved;
    let selectedText = '';
    const selectedReply = owner.createElement('button');
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
        selectedReply.style.left = `${Math.max(12, Math.min(rect.left, width - 160))}px`;
        selectedReply.style.top = `${Math.max(12, Math.min(rect.bottom + 4, height - 40))}px`;
      }
    };
    owner.addEventListener('selectionchange', captureSelection);
    const dispose = this.disposePopup;
    this.disposePopup = () => {
      owner.removeEventListener('selectionchange', captureSelection);
      dispose?.();
    };
    body.addEventListener('mouseup', captureSelection);
    body.addEventListener('keyup', captureSelection);
    const startReply = (text: string) => {
      if (!text || thread.resolved || !thread.comments.includes(comment)) return;
      this.quoteReply?.({ messageId: comment.id, text });
      selectedReply.hidden = true;
      owner.getSelection()?.removeAllRanges();
    };
    for (const button of [reply, selectedReply])
      button.addEventListener('mousedown', (event) => event.preventDefault());
    reply.addEventListener('click', () => {
      captureSelection();
      startReply(selectedText || comment.body);
    });
    selectedReply.addEventListener('click', () => startReply(selectedText));
    actions.append(reply, edit, remove);
    heading.append(actions);
    edit.addEventListener('click', () => {
      if (this.threadBusy(thread) || item.querySelector('.annotate-message-editor')) return;
      const form = owner.createElement('form'),
        input = owner.createElement('textarea'),
        buttons = owner.createElement('div');
      const save = owner.createElement('button'),
        cancel = owner.createElement('button');
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
      if (remove.dataset.confirm !== 'yes') {
        remove.dataset.confirm = 'yes';
        remove.classList.add('annotate-armed');
        remove.setAttribute('aria-label', 'Confirm remove comment');
        remove.title = 'Click again to remove';
        setTimeout(() => {
          delete remove.dataset.confirm;
          remove.classList.remove('annotate-armed');
          remove.setAttribute('aria-label', 'Remove comment');
          remove.title = 'Remove comment';
        }, 3000);
        return;
      }
      thread.comments = thread.comments.filter((message) => message.id !== comment.id);
      if (!thread.comments.length) {
        this.data.threads = this.data.threads.filter((t) => t.id !== thread.id);
        this.closePopup();
      } else {
        this.resetEditedConversation(thread);
        this.markdown.remove(body);
        item.remove();
        this.paintCodex();
      }
      this.changed();
      void this.persist();
    });
    body.className = 'annotate-message-body markdown-rendered';
    body.addEventListener('click', (event) => {
      const target = event.target;
      const link = target instanceof Element ? target.closest('a.internal-link') : null;
      const href = link?.getAttribute('data-href') ?? link?.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      void this.app.workspace.openLinkText(href, thread.path, event.metaKey || event.ctrlKey);
    });
    this.paintBody(body, comment, thread.path);
    item.append(heading);
    if (comment.quote) {
      const quoted = owner.createElement('blockquote');
      quoted.className = 'annotate-reply-quote';
      quoted.textContent = comment.quote.text;
      quoted.title = comment.quote.text;
      item.append(quoted);
    }
    item.append(body, selectedReply);
    list.append(item);
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
    for (const status of this.connectionLabel ? [this.connectionLabel] : [])
      status.textContent = `Codex: ${this.backend?.state ?? 'disabled'}${this.backend?.model ? ' · ' + this.backend.model : ''}${this.backend?.detail ? ' — ' + this.backend.detail : ''}`;
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
          ? 'ChatGPT is reading the note…'
          : turn === 'streaming'
            ? 'ChatGPT is writing…'
            : ['failed', 'unknown', 'unavailable'].includes(turn)
              ? (error ?? 'ChatGPT could not finish this response.')
              : state === 'disabled'
                ? 'ChatGPT is off. Enable Codex in settings to ask questions.'
                : state !== 'ready'
                  ? `ChatGPT is ${state}${error ? ' — ' + error : '…'}`
                  : '';
      status.textContent = text;
      status.hidden = !text;
      status.classList.toggle(
        'annotate-status-error',
        ['failed', 'unknown', 'unavailable'].includes(turn) || state === 'error',
      );
      status.title = `Codex: ${state} · ${turn}${this.backend?.model ? ' · ' + this.backend.model : ''}`;
    }
    const list = panel.querySelector<HTMLElement>('.annotate-messages');
    if (list) {
      const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      for (const comment of thread.comments) {
        let item = [...list.querySelectorAll<HTMLElement>('[data-message-id]')].find(
          (el) => el.dataset.messageId === comment.id,
        );
        if (!item) {
          this.messageElement(list, thread, comment);
          item = list.lastElementChild instanceof HTMLElement ? list.lastElementChild : undefined;
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
      if (pinned) list.scrollTop = list.scrollHeight;
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
      bar.hidden = [...bar.children].every((child) => child instanceof HTMLElement && child.hidden);
  }
  private async requestCodex(
    thread: Thread,
    question: string,
    history: ConversationMessage[],
    quote?: ReplyQuote,
  ): Promise<void> {
    const backend = this.backend;
    if (!backend || !this.data.codex.enabled) return;
    this.submissions.add(thread.id);
    this.cancellations.delete(thread.id);

    let response: Thread['comments'][number] | undefined;
    thread.codex = { ...thread.codex, status: 'pending', error: undefined };
    this.paintCodex();
    try {
      const sessionId = await backend.session(thread.codex.sessionId);
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
        author: 'Codex',
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
          isNewConversation ? history : [],
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
      );
    } catch (error) {
      if (thread.codex) {
        thread.codex.status =
          error instanceof SessionUnavailable
            ? 'unavailable'
            : error instanceof OutcomeUnknown
              ? 'unknown'
              : 'failed';
        thread.codex.error = error instanceof Error ? error.message : 'Codex request failed.';
      }
      if (response) response.status = error instanceof OutcomeUnknown ? 'unknown' : 'failed';
      this.changed();
      this.paintCodex();
    } finally {
      this.submissions.delete(thread.id);
      this.paintCodex();
    }
  }
  private async record(thread: Thread, body: string, quote?: ReplyQuote): Promise<boolean> {
    const question = invocation(body);
    if (question !== null) {
      if (!question) {
        new Notice('Add a question after @chatgpt.');
        return false;
      }
      if (!this.backend) {
        new Notice('Enable Codex in Annotate settings first.');
        return false;
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
        content: c.role === 'assistant' ? c.body : (invocation(c.body) ?? c.body),
        quote: c.quote,
      }));
    thread.comments.push({
      id: crypto.randomUUID(),
      author: this.data.author || 'You',
      body,
      ...(quote ? { quote } : {}),
      createdAt: Date.now(),
    });
    this.changed();
    await this.persistOrThrow();
    if (question !== null) void this.requestCodex(thread, question, history, quote);
    return true;
  }

  async onload(): Promise<void> {
    let raw: unknown = await this.loadData();
    if (raw === null || raw === undefined) {
      const adapter = this.app.vault.adapter;
      const legacyPath = `${this.app.vault.configDir}/plugins/selection-comments/data.json`;
      if (adapter?.exists && (await adapter.exists(legacyPath))) {
        try {
          const legacy = dataSchema.safeParse(JSON.parse(await adapter.read(legacyPath)));
          if (legacy.success) {
            raw = legacy.data;
            for (const thread of legacy.data.threads)
              if (thread.codex) {
                thread.codex.sessionId = undefined;
                thread.codex.contextVersion = undefined;
                if (!['pending', 'streaming'].includes(thread.codex.status))
                  thread.codex.status = 'idle';
              }
            new Notice('Annotate imported your comments from Selection Comments.');
          } else {
            new Notice(
              'Annotate could not read old comments. Keep Selection Comments installed to preserve them.',
            );
          }
        } catch {
          new Notice(
            'Annotate could not read old comments. Keep Selection Comments installed to preserve them.',
          );
        }
      }
    }
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
    for (const thread of this.data.threads)
      if (thread.codex && ['pending', 'streaming'].includes(thread.codex.status)) {
        const interrupted = thread.comments.find((c) => c.id === thread.codex?.turnMessageId);
        if (interrupted) interrupted.status = 'unknown';
        thread.codex.status = 'unknown';
        thread.codex.error = 'Obsidian closed during this response. It will not be resent.';
      }
    for (const thread of this.data.threads)
      if (thread.codex && thread.codex.contextVersion !== 2) {
        thread.codex.sessionId = undefined;
        thread.codex.contextVersion = 2;
        if (!['unknown', 'unavailable'].includes(thread.codex.status)) thread.codex.status = 'idle';
      }
    this.configureCodex();
    this.scheduleSave();
    const plugin = this;
    this.registerEditorExtension(
      ViewPlugin.fromClass(
        class {
          decorations: DecorationSet;
          path: string | null;
          constructor(readonly view: EditorView) {
            plugin.views.add(view);
            this.path = view.state.field(editorInfoField, false)?.file?.path ?? null;
            if (this.path) plugin.reconcile(this.path, view.state.doc.toString());
            this.decorations = plugin.decorations(view, this.path);
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
            this.path = path;
            if (
              pathChanged ||
              update.docChanged ||
              update.viewportChanged ||
              update.transactions.some((t) => t.effects.some((e) => e.is(refresh)))
            ) {
              this.decorations = plugin.decorations(update.view, path);
            }
          }
          destroy(): void {
            plugin.views.delete(this.view);
          }
        },
        {
          decorations: (value) => value.decorations,
          eventHandlers: {
            click: (event, view) => {
              const element = event.target;
              const win = view.dom.ownerDocument.defaultView;
              if (!win || !(element instanceof win.Element)) return false;
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
      const source = await this.noteText(context.sourcePath);
      if (this.disposed || source === null || !context.getSectionInfo(root)) return;
      if (this.documents.get(context.sourcePath) !== source)
        this.reconcile(context.sourcePath, source);
      const section: ReadingSection = { root, path: context.sourcePath, source, context };
      this.readingSections.set(root, section);
      context.addChild(
        new ReadingLifecycle(root, () => {
          this.readingSections.delete(root);
          clearReadingMarks(root);
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
    this.addCommand({
      id: 'add-selection-comment',
      name: 'Comment on selection',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'm' }],
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
    const ribbon = this.addRibbonIcon('message-square', 'Annotate', () =>
      new ThreadList(this).open(),
    );
    ribbon?.replaceChildren(pluginLogo(ribbon.ownerDocument));
    ribbon?.addClass('annotate-ribbon');
    this.addSettingTab(new CommentsSettings(this));
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
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.closePopup();
      }),
    );
  }

  onunload(): void {
    this.disposed = true;
    this.backend?.disable();
    this.backend = null;
    this.closePopup();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.storageHealthy) void this.persist();
    this.views.clear();
    for (const section of this.readingSections.values()) clearReadingMarks(section.root);
    this.readingSections.clear();
  }

  private async noteText(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
  }
  private renderReadingSection(section: ReadingSection): void {
    const info = section.context.getSectionInfo(section.root);
    if (!info) return;
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
        'annotate-highlight',
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
  decorations(view: EditorView, path: string | null): DecorationSet {
    if (!path) return Decoration.none;
    const ranges = [];
    for (const thread of this.data.threads) {
      const a = thread.anchor;
      if (thread.path !== path || thread.resolved || a.orphaned || a.to > view.state.doc.length)
        continue;
      if (!view.visibleRanges.some((range) => a.from < range.to && a.to > range.from)) continue;
      ranges.push(
        Decoration.mark({
          class: 'annotate-highlight',
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
    return Decoration.set(ranges, true);
  }
  refreshViews(exclude?: EditorView): void {
    requestAnimationFrame(() => {
      if (this.disposed) return;
      for (const view of this.views)
        if (view !== exclude) view.dispatch({ effects: refresh.of(null) });
      for (const section of this.readingSections.values())
        if (section.root.isConnected) this.renderReadingSection(section);
    });
  }
  changed(): void {
    this.scheduleSave();
    this.refreshViews();
  }
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, 300);
  }
  persist(): Promise<void> {
    return this.persistOrThrow().catch(() => {});
  }
  private persistOrThrow(): Promise<void> {
    const snapshot = structuredClone(this.data);
    const write = this.saveQueue.then(() => this.saveData(snapshot));
    this.saveQueue = write.catch((error) => {
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
    this.popup?.remove();
    this.popup = null;
    this.openThreadId = null;
    if (this.draft) {
      this.draft = null;
      this.refreshViews();
    }
  }
  private panel(rect?: Pick<DOMRect, 'left' | 'bottom'>, doc: Document = document): HTMLElement {
    this.closePopup();
    const panel = doc.createElement('section');
    panel.className = 'annotate-popover';
    panel.setAttribute('role', 'dialog');
    const title = doc.createElement('span');
    title.id = `annotate-thread-label-${crypto.randomUUID()}`;
    title.hidden = true;
    title.textContent = 'Comment thread';
    panel.setAttribute('aria-labelledby', title.id);
    panel.append(title);
    const header = doc.createElement('header');
    header.className = 'annotate-header';
    const close = iconButton(doc, 'x', 'Close comments', 'annotate-close');
    close.addEventListener('click', () => this.closePopup());
    header.append(close);
    panel.append(header);
    doc.body.append(panel);
    this.popup = panel;
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) this.closePopup();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closePopup();
      }
    };
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
    const win = doc.defaultView;
    if (!win) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(12, Math.min(rect?.left ?? (win.innerWidth - bounds.width) / 2, win.innerWidth - bounds.width - 12))}px`;
    element.style.top = `${Math.max(12, Math.min((rect?.bottom ?? 100) + 10, win.innerHeight - bounds.height - 12))}px`;
  }
  private quote(panel: HTMLElement, anchor: Anchor): void {
    const quote = panel.ownerDocument.createElement('blockquote');
    quote.className = 'annotate-quote';
    quote.textContent = anchor.quote;
    const header = panel.querySelector('.annotate-header');
    header ? header.prepend(quote) : panel.append(quote);
    if (anchor.orphaned) {
      const warning = panel.ownerDocument.createElement('p');
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
  ): void {
    const doc = panel.ownerDocument,
      form = doc.createElement('form'),
      input = doc.createElement('textarea'),
      button = doc.createElement('button');
    form.className = 'annotate-composer';
    input.placeholder = label;
    const inputLabel = doc.createElement('label');
    input.id = `annotate-composer-${crypto.randomUUID()}`;
    inputLabel.htmlFor = input.id;
    inputLabel.hidden = true;
    inputLabel.textContent = label;
    input.rows = 1;
    const avatar = doc.createElement('span');
    avatar.className = 'annotate-avatar';
    avatar.textContent = initial(this.data.author || 'You');
    avatar.setAttribute('aria-hidden', 'true');
    button.type = 'submit';
    button.append(icon(doc, 'up'));
    button.setAttribute('aria-label', 'Send comment');
    button.title = 'Save comment (Enter); new line (Shift+Enter)';
    button.className = 'annotate-send';
    button.disabled = true;
    input.addEventListener('input', () => {
      button.disabled = !input.value.trim();
      form.classList.toggle('annotate-has-text', !button.disabled);
      form.classList.toggle('annotate-asking-ai', invocation(input.value) !== null);
      input.style.height = 'auto';
      input.style.height = `${Math.min(160, Math.max(24, input.scrollHeight))}px`;
    });
    const inputContainer = doc.createElement('div');
    inputContainer.className = 'annotate-composer-input';
    let replyQuote: ReplyQuote | undefined;
    const preview = doc.createElement('div');
    preview.className = 'annotate-reply-preview';
    preview.hidden = true;
    const quoted = doc.createElement('blockquote');
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
    inputContainer.append(preview, input);
    mentionMenu(input, inputContainer);
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
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        event.stopPropagation();
        form.requestSubmit();
      }
    });
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
    rect ??= view?.coordsAtPos(target.anchor.to) ?? undefined;
    doc ??= view?.dom.ownerDocument;
    const panel = this.panel(rect, doc);
    panel.classList.add('annotate-new-comment');
    this.quote(panel, target.anchor);
    this.draft = { target, view };
    this.refreshViews();
    this.composer(
      panel,
      this.data.codex.enabled ? 'Add a comment, or @chatgpt to ask…' : 'Add a comment…',
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
    );
    this.position(panel, rect, panel.ownerDocument);
  }
  openThread(thread: Thread, rect?: Pick<DOMRect, 'left' | 'bottom'>, doc?: Document): void {
    const panel = this.panel(rect, doc),
      owner = panel.ownerDocument;
    this.quote(panel, thread.anchor);
    const list = owner.createElement('div');
    list.className = 'annotate-messages';
    panel.append(list);
    this.openThreadId = thread.id;
    for (const comment of thread.comments) this.messageElement(list, thread, comment);
    const header = panel.querySelector('.annotate-header'),
      close = header?.querySelector('.annotate-close');
    const actions = owner.createElement('div');
    actions.className = 'annotate-actions';
    header?.insertBefore(actions, close ?? null);
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
    let confirmed = false,
      disarm: ReturnType<typeof setTimeout> | undefined;
    remove.addEventListener('click', () => {
      if (!confirmed) {
        confirmed = true;
        remove.classList.add('annotate-armed');
        remove.setAttribute('aria-label', 'Confirm delete');
        remove.title = 'Click again to delete';
        disarm = setTimeout(() => {
          confirmed = false;
          remove.classList.remove('annotate-armed');
          remove.setAttribute('aria-label', 'Delete thread');
          remove.title = 'Delete thread';
        }, 3000);
        return;
      }
      clearTimeout(disarm);
      if (thread.codex?.sessionId)
        void this.backend?.interrupt(thread.codex.sessionId).catch(() => {});
      this.data.threads = this.data.threads.filter((t) => t.id !== thread.id);
      this.changed();
      this.closePopup();
    });
    if (thread.resolved) {
      const banner = owner.createElement('div');
      banner.className = 'annotate-resolved-banner';
      banner.append(icon(owner, 'check'), owner.createTextNode('Resolved'));
      panel.insertBefore(banner, list);
    }
    if (this.data.codex.enabled || thread.codex) {
      const bar = owner.createElement('div');
      bar.className = 'annotate-ai-bar';
      panel.append(bar);
      const status = owner.createElement('p');
      status.className = 'annotate-codex-status';
      status.setAttribute('role', 'status');
      bar.append(status);
      const cancel = owner.createElement('button');
      cancel.type = 'button';
      cancel.className = 'annotate-pill annotate-codex-cancel';
      cancel.append(icon(owner, 'stop'), owner.createTextNode('Stop'));
      bar.append(cancel);
      cancel.addEventListener('click', () => {
        this.cancellations.add(thread.id);
        if (thread.codex?.sessionId)
          void this.backend
            ?.interrupt(thread.codex.sessionId)
            .catch((error) => new Notice(String(error)));
      });
      const reconnect = owner.createElement('button');
      reconnect.type = 'button';
      reconnect.className = 'annotate-pill annotate-codex-reconnect';
      reconnect.append(icon(owner, 'refresh'), owner.createTextNode('Reconnect'));
      bar.append(reconnect);
      reconnect.addEventListener('click', () => {
        if (this.backend) void this.backend.connect().catch(() => this.paintCodex());
        else this.configureCodex();
      });
      const reset = owner.createElement('button');
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
        this.data.codex.enabled ? 'Reply, or @chatgpt to ask…' : 'Reply…',
        async (body, quote) => {
          if (!this.data.threads.includes(thread)) return false;
          if (!(await this.record(thread, body, quote))) return false;
          if (!this.disposed && this.data.threads.includes(thread)) this.paintCodex();
          return true;
        },
        true,
      );
    this.paintCodex();
    list.scrollTop = list.scrollHeight;
    this.position(panel, rect, owner);
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
        text: 'No comments yet. Select text, then press Cmd+Shift+M (Ctrl+Shift+M on Windows/Linux).',
      });
    for (const thread of threads) {
      const row = this.contentEl.createDiv({
        cls: `annotate-thread-row${thread.resolved ? ' annotate-is-resolved' : ''}`,
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
      open.addEventListener('click', () => {
        this.close();
        this.plugin.openThread(thread);
      });
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
          this.plugin.openThread(thread);
        });
      }
    }
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
class CommentsSettings extends PluginSettingTab {
  constructor(private plugin: Annotate) {
    super(plugin.app, plugin);
  }
  display(): void {
    this.containerEl.empty();
    const heading = this.containerEl.createEl('h2', {
      cls: 'annotate-brand-heading',
      text: 'Annotate',
    });
    heading.prepend(pluginLogo(this.containerEl.ownerDocument));
    new Setting(this.containerEl)
      .setName('Enable Codex')
      .setDesc(
        'Uses your local Codex CLI ChatGPT login. Answers use the note first and can search the web when helpful. Prefix a question with @chatgpt.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.data.codex.enabled).onChange((value) => {
          this.plugin.data.codex.enabled = value;
          this.plugin.changed();
          this.plugin.configureCodex();
        }),
      );
    new Setting(this.containerEl)
      .setName('Codex executable')
      .setDesc('Absolute path from command -v codex. Run codex login in Terminal first.')
      .addText((text) =>
        text.setValue(this.plugin.data.codex.executable).onChange((value) => {
          this.plugin.data.codex.executable = value.trim();
          this.plugin.changed();
        }),
      );
    new Setting(this.containerEl)
      .setName('Annotation context')
      .setDesc(
        'Always sends the complete current Markdown note, selected passage, question, and this annotation’s conversation. Runs in an isolated Codex environment without global skills, MCP tools, or AGENTS.md.',
      );
    const connection = this.containerEl.createEl('p', {
      cls: 'annotate-settings-codex-status',
      text: `Codex: ${this.plugin.backend?.state ?? 'disabled'}${this.plugin.backend?.model ? ' · ' + this.plugin.backend.model : ''}${this.plugin.backend?.detail ? ' — ' + this.plugin.backend.detail : ''}`,
    });
    connection.setAttribute('role', 'status');
    this.plugin.connectionLabel = connection;
    new Setting(this.containerEl)
      .setName('Reconnect Codex')
      .addButton((button) =>
        button.setButtonText('Reconnect').onClick(() => this.plugin.configureCodex()),
      );
    new Setting(this.containerEl)
      .setName('Comment author')
      .setDesc('Display name saved with new comments.')
      .addText((text) =>
        text.setValue(this.plugin.data.author).onChange((value) => {
          this.plugin.data.author = value;
          this.plugin.changed();
        }),
      );
  }
}

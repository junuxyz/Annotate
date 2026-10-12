import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { unlink, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const output = new URL('./.integration-plugin.mjs', import.meta.url);
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: output.pathname,
  platform: 'node',
  format: 'esm',
  alias: { obsidian: new URL('./host.mjs', import.meta.url).pathname },
  external: ['@codemirror/state', '@codemirror/view'],
});
const { default: Plugin } = await import(output.href);
await unlink(output);
const runtimeRoot = await mkdtemp(join(tmpdir(), 'annotate-ui-isolation-'));
const authSource = join(runtimeRoot, 'auth.json');
await writeFile(authSource, '{}');
const backendOutput = join(runtimeRoot, 'backend.cjs');
await build({
  entryPoints: ['src/codex.ts'],
  bundle: true,
  outfile: backendOutput,
  platform: 'node',
  format: 'cjs',
});
const { CodexBackend } = createRequire(import.meta.url)(backendOutput);
let runtimeSequence = 0;
function isolatedFactory(plugin) {
  plugin.createBackend = () =>
    new CodexBackend(plugin.data.codex.executable, () => plugin.paintCodex(), {
      home: join(runtimeRoot, 'home-' + ++runtimeSequence),
      authSource,
    });
}
after(() => rm(runtimeRoot, { recursive: true, force: true }));
const win = new Window();
for (const name of [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'MutationObserver',
  'DOMRect',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  const value = name === 'window' ? win : win[name];
  globalThis[name] = typeof value === 'function' && !value.prototype ? value.bind(win) : value;
}
win.Range.prototype.getClientRects = () => [new win.DOMRect(100, 100, 120, 20)];
win.Range.prototype.getBoundingClientRect = () => new win.DOMRect(100, 100, 120, 20);
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
const click = (element) => {
  assert.ok(element);
  element.click();
};
const send = async (text) => {
  const input = document.querySelector('.annotate-composer textarea');
  assert.ok(input);
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  const enter = new win.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
  input.dispatchEvent(enter);
  assert.equal(
    enter.defaultPrevented,
    true,
    'Enter saves the comment instead of inserting a line break',
  );
  await tick();
};

test('imports Selection Comments data once and resets obsolete Codex sessions', async () => {
  const legacy = {
    version: 1,
    author: 'You',
    threads: [
      {
        id: 'thread-1',
        path: 'note.md',
        anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
        comments: [{ id: 'comment-1', author: 'You', body: 'saved comment', createdAt: 1 }],
        resolved: false,
        codex: { sessionId: 'old-session', contextVersion: 2, status: 'completed' },
      },
    ],
    codex: { enabled: false, executable: 'codex' },
  };
  const plugin = new Plugin();
  plugin.app.vault.configDir = '.obsidian';
  plugin.app.vault.adapter = {
    exists: async (path) => path === '.obsidian/plugins/selection-comments/data.json',
    read: async () => JSON.stringify(legacy),
  };
  isolatedFactory(plugin);
  await plugin.onload();
  try {
    assert.equal(plugin.data.threads[0].comments[0].body, 'saved comment');
    assert.equal(plugin.data.threads[0].codex.sessionId, undefined);
    assert.equal(plugin.data.threads[0].codex.status, 'idle');
    await plugin.persist();
    assert.equal(plugin.saved.threads[0].comments[0].body, 'saved comment');
  } finally {
    plugin.onunload();
  }
});

test('ChatGPT mention picker completes with keyboard and mouse without submitting, including replies', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  const key = (input, value, options = {}) => {
    const event = new win.KeyboardEvent('keydown', {
      key: value,
      cancelable: true,
      bubbles: true,
      ...options,
    });
    input.dispatchEvent(event);
    return event;
  };
  const type = (input, value, caret = value.length) => {
    input.value = value;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  try {
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
      text: () => 'passage',
    });
    let input = document.querySelector('.annotate-composer textarea');
    let menu = document.querySelector('.annotate-mention-menu');
    type(input, '@');
    assert.equal(menu.hidden, false);
    assert.equal(menu.querySelectorAll('[role="option"]').length, 1);
    assert.equal(menu.querySelector('strong').textContent, 'ChatGPT');
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.equal(key(input, 'ArrowDown').defaultPrevented, true);
    assert.equal(key(input, 'Enter').defaultPrevented, true);
    await tick();
    assert.equal(input.value, '@chatgpt ');
    assert.equal(input.selectionStart, input.value.length);
    assert.equal(document.activeElement, input);
    assert.equal(menu.hidden, true);
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(
      plugin.data.threads.length,
      0,
      'completion does not save a comment or start a request',
    );

    type(input, 'Please @ch explain this', 'Please @ch'.length);
    click(menu.querySelector('button'));
    assert.equal(
      input.value,
      'Please @chatgpt explain this',
      'completion replaces only the token and preserves the suffix',
    );
    assert.equal(input.selectionStart, 'Please @chatgpt '.length);
    assert.equal(plugin.data.threads.length, 0);
    type(input, '@unknown');
    assert.equal(menu.hidden, true);
    type(input, 'mail@example.com');
    assert.equal(menu.hidden, true);
    type(input, '@chatgpt');
    assert.equal(menu.hidden, true, 'fully typed mentions keep the normal Enter behavior');

    type(input, '@');
    assert.equal(key(input, 'Escape').defaultPrevented, true);
    assert.ok(
      document.querySelector('.annotate-popover'),
      'Escape dismisses the menu before the comment',
    );
    assert.equal(menu.hidden, true);
    type(input, '@c');
    assert.equal(menu.hidden, false);
    assert.equal(key(input, 'Enter', { shiftKey: true }).defaultPrevented, false);
    assert.equal(input.value, '@c', 'Shift+Enter does not complete or submit');
    input.dispatchEvent(new win.Event('compositionstart'));
    assert.equal(menu.hidden, true);
    assert.equal(key(input, 'Enter', { isComposing: true }).defaultPrevented, false);
    input.dispatchEvent(new win.Event('compositionend'));
    assert.equal(menu.hidden, false);
    type(input, 'ordinary comment');
    await send('ordinary comment');
    assert.equal(plugin.data.threads.length, 1);
    input = document.querySelector('.annotate-composer textarea');
    menu = document.querySelector('.annotate-mention-menu');
    type(input, '@CHAT');
    key(input, 'ArrowUp');
    key(input, 'Enter');
    assert.equal(input.value, '@chatgpt ');
    assert.equal(
      plugin.data.threads[0].comments.length,
      1,
      'reply completion also does not submit',
    );
    plugin.closePopup();
    assert.equal(document.querySelector('.annotate-mention-menu'), null);
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('editor interaction: create, reply, resolve, reopen, edits, persistence, cleanup', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: 'before selected after', extensions: plugin.extensions }),
  });
  try {
    view.dispatch({ selection: { anchor: 7, head: 15 } });
    view.focus();
    view.contentDOM.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
    await tick();
    assert.equal(
      document.querySelector('.annotate-selection-action'),
      null,
      'selecting text must not show a floating Comment button',
    );
    assert.equal(
      document.querySelector('.annotate-popover'),
      null,
      'selection alone must not open the composer',
    );
    const command = plugin.commands.find((c) => c.id === 'add-selection-comment');
    assert.deepEqual(command.hotkeys, [{ modifiers: ['Mod', 'Shift'], key: 'm' }]);
    const editor = {
      getSelection: () => view.state.sliceDoc(7, 15),
      getValue: () => view.state.doc.toString(),
      getCursor: (side) => (side === 'from' ? 7 : 15),
      posToOffset: (pos) => pos,
    };
    plugin.activeView = {
      file: { path: 'test.md' },
      getMode: () => 'source',
      editor,
      containerEl: parent,
    };
    assert.equal(command.checkCallback(false), true);
    await tick();
    assert.ok(document.querySelector('.annotate-new-comment'), 'shortcut opens compact composer');
    assert.ok(
      document.querySelector('.annotate-draft-selection'),
      'selection stays highlighted while typing',
    );
    assert.equal(document.activeElement, document.querySelector('.annotate-composer textarea'));
    assert.equal(
      document.querySelector('.annotate-popover').style.top,
      '130px',
      'shortcut popup is placed at the selection',
    );
    document.dispatchEvent(new win.Event('scroll'));
    plugin.app.workspace.emit('layout-change');
    await tick();
    assert.ok(
      document.querySelector('.annotate-new-comment'),
      'scroll and routine layout events must not dismiss the composer',
    );
    assert.equal(document.querySelector('.annotate-quote').textContent, 'selected');
    const input = document.querySelector('.annotate-composer textarea');
    input.value = '한글 입력';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    const shiftEnter = new win.KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      cancelable: true,
      bubbles: true,
    });
    input.dispatchEvent(shiftEnter);
    assert.equal(
      shiftEnter.defaultPrevented,
      false,
      'Shift+Enter keeps the native textarea line break',
    );
    const composingEnter = new win.KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      cancelable: true,
      bubbles: true,
    });
    input.dispatchEvent(composingEnter);
    assert.equal(
      composingEnter.defaultPrevented,
      false,
      'Enter during Korean IME composition must not save',
    );
    await tick();
    assert.equal(
      plugin.data.threads.length,
      0,
      'Shift+Enter and composition Enter must not submit',
    );
    await send('<img src=x onerror=alert(1)>');
    assert.equal(plugin.data.threads.length, 1);
    assert.ok(document.querySelector('.annotate-highlight'));
    assert.equal(document.querySelector('.annotate-count').textContent, '1');
    assert.equal(
      document.querySelector('.annotate-messages .annotate-message-body').textContent,
      '<img src=x onerror=alert(1)>',
    );
    assert.equal(document.querySelector('.annotate-messages img'), null);
    await send('a reply\nsecond line');
    assert.equal(plugin.data.threads[0].comments[1].body, 'a reply\nsecond line');
    assert.equal(document.querySelectorAll('.annotate-messages article').length, 2);
    assert.equal(document.querySelector('.annotate-count').textContent, '2');
    click(document.querySelector('.annotate-actions button'));
    await tick();
    assert.equal(plugin.data.threads[0].resolved, true);
    assert.equal(document.querySelector('.annotate-highlight'), null);
    assert.equal(document.querySelector('.annotate-composer'), null);
    click(document.querySelector('.annotate-actions button'));
    await tick();
    assert.ok(document.querySelector('.annotate-highlight'));
    click(document.querySelector('.annotate-close'));
    view.dispatch({ changes: { from: 0, insert: 'intro ' } });
    await tick();
    assert.equal(plugin.data.threads[0].anchor.from, 13);
    const before = view.state.doc.toString();
    click(document.querySelector('.annotate-count'));
    await send('third reply');
    assert.equal(view.state.doc.toString(), before);
    assert.equal(plugin.saved.threads[0].comments.length, 3);
    click(document.querySelector('.annotate-close'));
    view.dispatch({ changes: { from: 13, to: 21 } });
    await tick();
    assert.equal(plugin.data.threads[0].anchor.orphaned, true);
    assert.equal(document.querySelector('.annotate-highlight'), null);
  } finally {
    plugin.onunload();
    view.destroy();
    await tick();
    assert.equal(document.querySelector('.annotate-popover'), null);
    assert.equal(document.querySelector('.annotate-selection-action'), null);
  }
});

test('reading mode: existing highlights, shortcut, Enter save, reply counts and cleanup', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  const source =
    '# Title\n\nThe **bold** and [link](https://example.com) stay.\n\nSecond paragraph.';
  plugin.source = source;
  const preview = document.createElement('div');
  document.body.append(preview);
  const first = document.createElement('div');
  first.innerHTML =
    '<p>The <strong>bold</strong> and <a href="https://example.com">link</a> stay.</p>';
  const second = document.createElement('div');
  second.innerHTML = '<p>Second paragraph.</p>';
  preview.append(first, second);
  plugin.activeView = { file: { path: 'test.md' }, getMode: () => 'preview', containerEl: preview };
  const from = source.indexOf('bold'),
    to = source.indexOf(' stay.');
  plugin.data.threads.push({
    id: 'existing',
    path: 'test.md',
    resolved: false,
    anchor: {
      from,
      to,
      quote: source.slice(from, to),
      prefix: source.slice(0, from),
      suffix: source.slice(to),
      orphaned: false,
    },
    comments: [{ id: 'comment', author: 'You', body: 'saved in editing mode', createdAt: 0 }],
  });
  const children = [];
  const context = (lineStart, lineEnd) => ({
    sourcePath: 'test.md',
    getSectionInfo: () => ({ text: source, lineStart, lineEnd }),
    addChild: (child) => children.push(child),
  });
  try {
    await plugin.postProcessors[0](first, context(2, 2));
    await plugin.postProcessors[0](second, context(4, 4));
    assert.ok(first.querySelector('strong .annotate-highlight'));
    assert.ok(first.querySelector('a .annotate-highlight'));
    assert.equal(first.querySelector('.annotate-count').textContent, '1');
    const text = second.querySelector('p').firstChild;
    const selection = document.getSelection(),
      range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    selection.removeAllRanges();
    selection.addRange(range);
    const command = plugin.commands.find((c) => c.id === 'add-selection-comment');
    assert.equal(command.checkCallback(true), true);
    assert.equal(command.checkCallback(false), true);
    await tick();
    assert.ok(second.querySelector('.annotate-draft-selection'));
    assert.equal(document.querySelector('.annotate-quote').textContent, 'Second');
    await send('created from reading mode');
    assert.equal(plugin.data.threads.length, 2);
    assert.equal(plugin.data.threads[1].anchor.quote, 'Second');
    assert.ok(second.querySelector('.annotate-highlight'));
    assert.equal(second.querySelector('.annotate-count').textContent, '1');
    await send('reading reply');
    assert.equal(second.querySelector('.annotate-count').textContent, '2');
    assert.equal(plugin.saved.threads[1].comments.length, 2);
    assert.equal(plugin.source, source, 'reading annotations do not edit the note');
    click(document.querySelector('.annotate-close'));
    click(first.querySelector('.annotate-count'));
    assert.equal(
      document.querySelector('.annotate-messages .annotate-message-body').textContent,
      'saved in editing mode',
    );
    click(document.querySelector('.annotate-actions button'));
    await tick();
    assert.equal(first.querySelector('.annotate-highlight'), null);
    assert.ok(second.querySelector('.annotate-highlight'));
  } finally {
    plugin.onunload();
    for (const child of children) child.onunload();
    await tick();
    assert.equal(preview.querySelector('.annotate-reading-mark'), null);
    assert.equal(preview.querySelector('.annotate-reading-count'), null);
    preview.remove();
  }
});

after(async () => {
  await win.happyDOM.close();
});

test('Codex streams in the existing annotation, retains draft, cancels and restores persisted messages', async () => {
  const { createRequire } = await import('node:module');
  globalThis.require = createRequire(import.meta.url);
  const fixture = new URL('./codex-fixture.cjs', import.meta.url).pathname;
  const plugin = new Plugin();
  isolatedFactory(plugin);
  plugin.source = 'complete note content';
  const settingsWindow = new Window();
  plugin.connectionLabel = settingsWindow.document.createElement('p');
  plugin.loadData = async () => ({
    version: 1,
    author: 'You',
    threads: [],
    codex: { enabled: true, executable: fixture, surroundingContent: false },
  });
  await plugin.onload();
  try {
    await plugin.backend.connect();
    assert.match(
      plugin.connectionLabel.textContent,
      /ready/,
      'a separate settings window receives connection changes',
    );
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
      text: () => 'passage',
    });
    await send('@chatgpt Explain this passage');
    const thread = plugin.data.threads[0];
    assert.equal(thread.comments[0].body, '@chatgpt Explain this passage');
    assert.equal(
      document.querySelector('.annotate-messages .annotate-message-body').textContent,
      '@chatgpt Explain this passage',
    );
    const input = document.querySelector('.annotate-composer textarea');
    input.value = 'a draft while streaming';
    await tick();
    await tick();
    assert.equal(thread.comments[1].body, 'Hello world');
    assert.equal(document.querySelectorAll('.annotate-messages article').length, 2);
    const assistantLogo = document.querySelector('.annotate-message-ai .annotate-openai-icon');
    assert.equal(assistantLogo?.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(
      assistantLogo?.querySelector('path')?.getAttribute('d')?.startsWith('M22.2819'),
      true,
    );
    assert.equal(
      document.querySelectorAll('.annotate-messages .annotate-message-body')[1].textContent,
      'Hello world',
    );
    assert.equal(input.value, 'a draft while streaming');
    assert.equal(thread.codex.status, 'completed');
    const id = thread.codex.sessionId;
    await send('@chatgpt followup');
    click(document.querySelector('.annotate-codex-cancel'));
    await tick();
    await tick();
    assert.equal(thread.codex.status, 'cancelled');
    assert.equal(thread.codex.sessionId, id);
    assert.equal(plugin.backend.launches, 1);
    await plugin.persist();
    const saved = structuredClone(plugin.saved);
    assert.equal(saved.threads[0].comments[0].body, '@chatgpt Explain this passage');
    assert.ok(saved.threads[0].comments.some((comment) => comment.body === '@chatgpt followup'));
    assert.equal(saved.threads[0].codex.sessionId, id);
    plugin.onunload();
    const restored = new Plugin();
    isolatedFactory(restored);
    restored.loadData = async () => saved;
    await restored.onload();
    try {
      restored.openThread(restored.data.threads[0]);
      assert.equal(
        document.querySelector('.annotate-messages .annotate-message-body').textContent,
        '@chatgpt Explain this passage',
      );
      assert.equal(
        document.querySelectorAll('.annotate-messages .annotate-message-body')[1].textContent,
        'Hello world',
      );
      await send('@chatgpt another followup');
      for (
        let attempt = 0;
        attempt < 40 && ['pending', 'streaming'].includes(restored.data.threads[0].codex.status);
        attempt++
      )
        await tick();
      assert.equal(restored.data.threads[0].codex.sessionId, id);
      assert.equal(restored.data.threads[0].codex.status, 'completed');
      assert.equal(restored.backend.launches, 1);
    } finally {
      restored.onunload();
    }
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('interrupted responses recover as unknown and require explicit new conversation', async () => {
  const plugin = new Plugin();
  plugin.loadData = async () => ({
    version: 1,
    author: 'You',
    threads: [
      {
        id: 'interrupted',
        path: 'test.md',
        anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
        resolved: false,
        comments: [
          { id: 'q', author: 'You', body: 'question', createdAt: 1 },
          {
            id: 'a',
            author: 'Codex',
            role: 'assistant',
            body: 'partial answer',
            status: 'streaming',
            createdAt: 2,
          },
        ],
        codex: { sessionId: 'old-session', turnMessageId: 'a', status: 'streaming' },
      },
    ],
  });
  await plugin.onload();
  try {
    const thread = plugin.data.threads[0];
    assert.equal(thread.codex.status, 'unknown');
    assert.equal(thread.comments[1].status, 'unknown');
    plugin.openThread(thread);
    assert.equal(
      document.querySelectorAll('.annotate-messages .annotate-message-body')[1].textContent,
      'partial answer',
    );
    assert.equal(document.querySelector('.annotate-codex-reset').hidden, false);
    click(document.querySelector('.annotate-codex-reset'));
    assert.equal(thread.codex.status, 'idle');
    assert.equal(thread.codex.sessionId, undefined);
    assert.equal(thread.comments.length, 2);
    await plugin.persist();
    assert.equal(plugin.saved.threads[0].comments[1].body, 'partial answer');
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('legacy native sessions are replaced while their annotation transcript is preserved', async () => {
  const plugin = new Plugin();
  plugin.loadData = async () => ({
    version: 1,
    author: 'You',
    threads: [
      {
        id: 'legacy',
        path: 'test.md',
        anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
        resolved: false,
        comments: [
          { id: 'q', author: 'You', body: 'prior question', createdAt: 1 },
          {
            id: 'a',
            author: 'Codex',
            role: 'assistant',
            body: 'prior answer',
            status: 'completed',
            createdAt: 2,
          },
        ],
        codex: { sessionId: 'contaminated-session', status: 'completed' },
      },
    ],
  });
  await plugin.onload();
  try {
    const thread = plugin.data.threads[0];
    assert.equal(thread.codex.sessionId, undefined);
    assert.equal(thread.codex.contextVersion, 2);
    assert.equal(thread.codex.status, 'idle');
    assert.deepEqual(
      thread.comments.map((c) => c.body),
      ['prior question', 'prior answer'],
    );
    await plugin.persist();
    assert.equal(plugin.saved.threads[0].codex.sessionId, undefined);
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('a missing Markdown note fails before sending a model turn', async () => {
  const plugin = new Plugin();
  isolatedFactory(plugin);
  plugin.loadData = async () => ({
    version: 1,
    author: 'You',
    threads: [],
    codex: { enabled: true, executable: new URL('./codex-fixture.cjs', import.meta.url).pathname },
  });
  plugin.app.vault.cachedRead = async () => null;
  await plugin.onload();
  try {
    await plugin.backend.connect();
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
      text: () => 'passage',
    });
    await send('@chatgpt question');
    await tick();
    const thread = plugin.data.threads[0];
    assert.equal(thread.codex.status, 'failed');
    assert.match(thread.codex.error, /Markdown note is unavailable/);
    assert.equal(thread.comments.at(-1).status, 'failed');
    assert.equal(thread.comments.at(-1).body, '');
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('edit and remove individual comments preserve drafts, reset conversation history, and remove empty threads', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  try {
    plugin.source = 'passage';
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
      text: () => 'passage',
    });
    await send('original $x$');
    await send('reply');
    const thread = plugin.data.threads[0];
    thread.codex = { status: 'completed', sessionId: 'old-session', contextVersion: 2 };
    const draft = document.querySelector('.annotate-composer textarea');
    draft.value = 'unsent reply';
    click(document.querySelector('.annotate-message-edit'));
    let input = document.querySelector('.annotate-message-editor textarea');
    assert.equal(input.value, 'original $x$');
    input.value = 'edited $y$\n한글';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(thread.comments[0].body, 'original $x$', 'IME Enter does not save');
    input.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.ok(
      document.querySelector('.annotate-message-editor'),
      'Shift+Enter keeps the editor open',
    );
    input.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await tick();
    assert.equal(thread.comments[0].body, 'edited $y$\n한글');
    assert.equal(plugin.saved.threads[0].comments[0].body, 'edited $y$\n한글');
    assert.equal(thread.codex.sessionId, undefined, 'next model turn imports edited history');
    assert.equal(draft.value, 'unsent reply');
    assert.equal(document.querySelector('.annotate-message-editor'), null);
    click(document.querySelector('.annotate-message-edit'));
    input = document.querySelector('.annotate-message-editor textarea');
    input.value = 'discard';
    input.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert.ok(
      document.querySelector('.annotate-popover'),
      'Escape cancels edit without closing thread',
    );
    assert.equal(thread.comments[0].body, 'edited $y$\n한글');
    thread.codex = { status: 'streaming', sessionId: 'busy' };
    plugin.paintCodex();
    assert.equal(document.querySelector('.annotate-message-edit').disabled, true);
    assert.equal(document.querySelector('.annotate-message-remove').disabled, true);
    thread.codex.status = 'completed';
    plugin.paintCodex();
    click(document.querySelector('.annotate-message-remove'));
    assert.equal(thread.comments.length, 2, 'first click only arms removal');
    click(document.querySelector('.annotate-message-remove'));
    await tick();
    assert.equal(thread.comments.length, 1);
    assert.equal(thread.comments[0].body, 'reply');
    assert.equal(thread.codex.sessionId, undefined);
    assert.equal(draft.value, 'unsent reply');
    click(document.querySelector('.annotate-message-remove'));
    click(document.querySelector('.annotate-message-remove'));
    await tick();
    assert.equal(plugin.data.threads.length, 0);
    assert.equal(plugin.saved.threads.length, 0);
    assert.equal(document.querySelector('.annotate-popover'), null);
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('posting a reply keeps an open comment edit and saves it against the same message', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  try {
    plugin.source = 'passage';
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
      text: () => 'passage',
    });
    await send('original');
    click(document.querySelector('.annotate-message-edit'));
    const editor = document.querySelector('.annotate-message-editor textarea');
    editor.value = 'unsaved edit';
    await send('reply while editing');
    assert.equal(document.querySelector('.annotate-message-editor textarea'), editor);
    assert.equal(editor.value, 'unsaved edit');
    assert.equal(document.querySelectorAll('.annotate-messages article').length, 2);
    assert.equal(plugin.data.threads[0].comments[0].body, 'original');
    document.querySelector('.annotate-message-editor').requestSubmit();
    await tick();
    assert.deepEqual(
      plugin.saved.threads[0].comments.map((c) => c.body),
      ['unsaved edit', 'reply while editing'],
    );
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('selected reply quotes stay in the thread, survive reload, and reach resumed Codex turns', async () => {
  globalThis.require = createRequire(import.meta.url);
  const plugin = new Plugin();
  isolatedFactory(plugin);
  plugin.source = 'synthetic note';
  plugin.loadData = async () => ({
    version: 1,
    author: 'You',
    threads: [],
    codex: { enabled: true, executable: new URL('./codex-fixture.cjs', import.meta.url).pathname },
  });
  await plugin.onload();
  try {
    await plugin.backend.connect();
    const requests = [];
    const ask = plugin.backend.ask.bind(plugin.backend);
    plugin.backend.ask = (id, content, ...rest) => {
      requests.push(JSON.parse(content));
      return ask(id, content, ...rest);
    };
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 9, quote: 'synthetic', prefix: '', suffix: '', orphaned: false },
      text: () => 'synthetic note',
    });
    await send('@chatgpt explain');
    await tick();
    await tick();
    const thread = plugin.data.threads[0];
    const session = thread.codex.sessionId;
    const body = document.querySelector('.annotate-message-ai .annotate-message-body');
    const node = document.createTreeWalker(body, 4).nextNode();
    const range = document.createRange();
    range.setStart(node, 6);
    range.setEnd(node, 11);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    body.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
    const reply = body.closest('article').querySelector('.annotate-selection-reply');
    assert.equal(reply.hidden, false);
    click(reply);
    assert.equal(document.querySelector('.annotate-reply-preview blockquote').textContent, 'world');
    await send('@chatgpt explain that part');
    await tick();
    await tick();
    assert.equal(plugin.data.threads.length, 1);
    assert.equal(thread.codex.sessionId, session);
    assert.equal(thread.codex.status, 'completed');
    const quote = { messageId: thread.comments[1].id, text: 'world' };
    assert.deepEqual(thread.comments[2].quote, quote);
    assert.deepEqual(requests[1].quotedReply, quote);
    assert.equal(requests[1].question, 'explain that part');
    assert.deepEqual(requests[1].conversationHistory, []);
    assert.equal(document.querySelector('.annotate-reply-preview').hidden, true);
    await plugin.persist();
    const saved = structuredClone(plugin.saved);
    plugin.onunload();
    const restored = new Plugin();
    restored.loadData = async () => ({ ...saved, codex: { ...saved.codex, enabled: false } });
    await restored.onload();
    try {
      restored.openThread(restored.data.threads[0]);
      assert.equal(
        document.querySelector('.annotate-message .annotate-reply-quote').textContent,
        'world',
      );
      click(document.querySelector('.annotate-message-reply'));
      click(document.querySelector('.annotate-reply-preview [aria-label="Remove quote"]'));
      await send('ordinary reply');
      assert.equal(restored.data.threads[0].comments.at(-1).quote, undefined);
    } finally {
      restored.onunload();
    }
  } finally {
    plugin.onunload();
    await tick();
  }
});

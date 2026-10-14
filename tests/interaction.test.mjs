import { same, until } from './assertions.mjs';
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
  loader: { '.png': 'dataurl' },
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
win.HTMLElement.prototype.isShown = function () {
  if (!this.isConnected) return false;
  for (let element = this; element; element = element.parentElement)
    if (win.getComputedStyle(element).display === 'none') return false;
  return true;
};
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
    assert.equal(menu.querySelectorAll('[role="option"]').length, 2);
    assert.equal(menu.querySelector('strong').textContent, 'ChatGPT');
    const claudeLogo = menu.querySelector('.annotate-claude-icon path');
    const chatgptLogo = menu.querySelector('.annotate-openai-icon path');
    assert.ok(claudeLogo && chatgptLogo);
    assert.notEqual(claudeLogo.getAttribute('d'), chatgptLogo.getAttribute('d'));

    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.equal(key(input, 'ArrowDown').defaultPrevented, true);
    assert.equal(key(input, 'Enter').defaultPrevented, true);
    await tick();
    assert.equal(input.value, '@chatgpt ');
    assert.equal(input.selectionStart, input.value.length);
    same(document.activeElement, input);
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
    type(input, '@cl');
    const claudeOption = [...menu.querySelectorAll('button')].find((b) =>
      b.textContent.includes('@claude'),
    );
    assert.equal(claudeOption.hidden, false);
    click(claudeOption);
    assert.equal(input.value, '@claude ');
    type(input, '@');
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    assert.equal(input.value, '@claude ');
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
    await until(
      () => !document.querySelector('.annotate-mention-menu'),
      'Closed mention menu must be removed after its exit animation',
    );
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
    same(
      document.querySelector('.annotate-selection-action'),
      null,
      'selecting text must not show a floating Comment button',
    );
    same(
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
    same(document.activeElement, document.querySelector('.annotate-composer textarea'));
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
    same(document.querySelector('.annotate-messages img'), null);
    await send('a reply\nsecond line');
    assert.equal(plugin.data.threads[0].comments[1].body, 'a reply\nsecond line');
    assert.equal(document.querySelectorAll('.annotate-messages article').length, 2);
    assert.equal(document.querySelector('.annotate-count').textContent, '2');
    click(document.querySelector('.annotate-resolve'));
    await tick();
    assert.equal(plugin.data.threads[0].resolved, true);
    same(document.querySelector('.annotate-highlight'), null);
    same(document.querySelector('.annotate-composer'), null);
    click(document.querySelector('.annotate-resolve'));
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
    same(document.querySelector('.annotate-highlight'), null);
  } finally {
    plugin.onunload();
    view.destroy();
    await tick();
    same(document.querySelector('.annotate-popover'), null);
    same(document.querySelector('.annotate-selection-action'), null);
  }
});

test('closing the last editor releases cached note text and reopening restores its comments', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  const source = 'before passage after';
  const parent = document.createElement('div');
  document.body.append(parent);
  const open = () =>
    new EditorView({
      parent,
      state: EditorState.create({ doc: source, extensions: plugin.extensions }),
    });
  let first = open();
  const second = open();
  try {
    first.dispatch({ selection: { anchor: 7, head: 14 } });
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: {
        from: 7,
        to: 14,
        quote: 'passage',
        prefix: 'before ',
        suffix: ' after',
        orphaned: false,
      },
      text: () => source,
    });
    await send('Keep this saved comment');
    plugin.closePopup();
    first.destroy();
    assert.equal(plugin.documents.get('test.md'), source, 'a split editor still needs the note');
    second.destroy();
    assert.equal(plugin.documents.has('test.md'), false, 'closed notes must not stay cached');
    assert.equal(plugin.saved.threads[0].comments[0].body, 'Keep this saved comment');
    first = open();
    await tick();
    assert.equal(plugin.documents.get('test.md'), source);
    assert.equal(parent.querySelector('.annotate-highlight').textContent, 'passage');
    click(parent.querySelector('.annotate-count'));
    assert.equal(
      document.querySelector('.annotate-message-body').textContent,
      'Keep this saved comment',
    );
  } finally {
    plugin.onunload();
    first.destroy();
    second.destroy();
    parent.remove();
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
    click(document.querySelector('.annotate-resolve'));
    await tick();
    same(first.querySelector('.annotate-highlight'), null);
    assert.ok(second.querySelector('.annotate-highlight'));
    preview.style.display = 'none';
    const hiddenMarkup = preview.innerHTML;
    plugin.data.threads[0].resolved = false;
    plugin.data.threads[1].comments.push({
      id: 'hidden-reply',
      author: 'You',
      body: 'A reply while Reading is hidden',
      createdAt: 1,
    });
    plugin.changed();
    await tick();
    plugin.app.workspace.emit('layout-change');
    await tick();
    assert.equal(preview.innerHTML, hiddenMarkup, 'hidden previews do not rebuild their marks');
    preview.style.display = '';
    plugin.app.workspace.emit('layout-change');
    await tick();
    assert.equal(first.querySelector('.annotate-count').textContent, '1');
    assert.equal(second.querySelector('.annotate-count').textContent, '3');
    assert.equal(
      [...first.querySelectorAll('.annotate-highlight')].map((mark) => mark.textContent).join(''),
      'bold and link',
      'showing Reading restores the current highlight and comment counts',
    );
  } finally {
    plugin.onunload();
    for (const child of children) child.onunload();
    await tick();
    same(preview.querySelector('.annotate-reading-mark'), null);
    same(preview.querySelector('.annotate-reading-count'), null);
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
  plugin.connectionLabels.set('chatgpt', settingsWindow.document.createElement('p'));
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
      plugin.connectionLabels.get('chatgpt').textContent,
      /Ready/,
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
    same(document.querySelector('.annotate-message-editor'), null);
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
    assert.equal(thread.comments.length, 1, 'one click removes the comment and offers Undo');
    await tick();
    assert.equal(thread.comments.length, 1);
    assert.equal(thread.comments[0].body, 'reply');
    assert.equal(thread.codex.sessionId, undefined);
    assert.equal(draft.value, 'unsent reply');
    await until(
      () => document.querySelectorAll('.annotate-messages article').length === 1,
      'Removed message must finish its exit animation',
    );
    click(document.querySelector('.annotate-message-remove'));
    await tick();
    assert.equal(plugin.data.threads.length, 0);
    assert.equal(plugin.saved.threads.length, 0);
    same(document.querySelector('.annotate-popover'), null);
    const undo = document.querySelector('.annotate-toast-undo');
    assert.ok(undo, 'removing the last comment offers Undo');
    click(undo);
    await tick();
    assert.equal(plugin.data.threads.length, 1, 'Undo restores the deleted thread');
    assert.equal(plugin.data.threads[0].comments[0].body, 'reply');
    assert.equal(plugin.saved.threads.length, 1, 'Undo is saved');
    await until(
      () => !document.querySelector('.annotate-toast'),
      'Undo notice must leave after its exit animation',
    );
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
    same(document.querySelector('.annotate-message-editor textarea'), editor);
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

test('copy message and entire thread preserve Markdown and read the latest conversation', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  const clipboard = win.navigator.clipboard;
  const original = clipboard.writeText;
  const copied = [];
  clipboard.writeText = async (text) => {
    copied.push(text);
  };
  const thread = {
    id: 'copy-thread',
    path: 'test.md',
    resolved: false,
    anchor: { from: 0, to: 8, quote: 'selected\npassage', prefix: '', suffix: '', orphaned: false },
    comments: [
      {
        id: 'first',
        author: 'You',
        body: '**Question**\n\n```js\nconst x = 1;\n```',
        createdAt: 1,
      },
      {
        id: 'second',
        author: 'Assistant',
        role: 'assistant',
        body: 'Partial',
        status: 'streaming',
        createdAt: 2,
        quote: { messageId: 'first', text: 'Question\ncode' },
      },
    ],
  };
  plugin.data.threads = [thread];
  try {
    plugin.openThread(thread);
    const buttons = document.querySelectorAll('.annotate-message-copy');
    assert.equal(buttons.length, 2);
    click(buttons[0]);
    await tick();
    assert.equal(copied[0], thread.comments[0].body);
    assert.equal(buttons[0].getAttribute('aria-label'), 'Copied');
    thread.comments[1].body = 'Finished **answer**';
    click(buttons[1]);
    await tick();
    assert.equal(copied[1], 'Finished **answer**');
    thread.comments.push({ id: 'third', author: 'You', body: 'Follow-up', createdAt: 3 });
    click(document.querySelector('.annotate-copy-thread'));
    await tick();
    assert.equal(
      copied[2],
      '> selected\n> passage\n\n---\n\nYou:\n\n**Question**\n\n```js\nconst x = 1;\n```\n\n---\n\nChatGPT:\n\n> Question\n> code\n\nFinished **answer**\n\n---\n\nYou:\n\nFollow-up',
    );
    thread.resolved = true;
    plugin.openThread(thread);
    assert.equal(document.querySelectorAll('.annotate-message-copy').length, 3);
    clipboard.writeText = async () => {
      throw new Error('Clipboard denied');
    };
    const failed = document.querySelector('.annotate-copy-thread');
    click(failed);
    await tick();
    assert.equal(failed.getAttribute('aria-label'), 'Copy entire thread');
    same(plugin.data.threads[0], thread);
  } finally {
    clipboard.writeText = original;
    plugin.onunload();
  }
});

test('Claude mentions route without changing settings first and connection probes preserve the live backend', async () => {
  const plugin = new Plugin();
  await plugin.onload();
  const asked = [];
  plugin.createBackend = (provider = plugin.data.assistant.provider) => {
    return {
      state: 'disabled',
      detail: '',
      model: 'test',
      retainsHistory: false,
      async enable() {
        this.state = 'ready';
      },
      async connect() {
        this.state = 'ready';
      },
      async session() {
        return crypto.randomUUID();
      },
      async ask(id, text, delta, finish) {
        asked.push({ provider, text: JSON.parse(text.slice(text.indexOf('{'))) });
        delta(`${provider} answer`);
        finish('completed');
      },
      async interrupt() {},
      disable() {
        this.state = 'disabled';
      },
    };
  };
  try {
    plugin.data.codex.enabled = true;
    plugin.configureCodex();
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
      text: () => 'passage',
    });
    await send('@claude explain');
    await tick();
    assert.equal(plugin.data.assistant.provider, 'claude');
    assert.equal(asked[0].provider, 'claude');
    assert.equal(plugin.data.threads[0].comments.at(-1).provider, 'claude');
    assert.ok(document.querySelector('.annotate-avatar-ai .annotate-claude-icon'));
    assert.equal(
      document.querySelector('.annotate-avatar-ai .annotate-openai-icon') === null,
      true,
    );

    const live = plugin.backend;
    assert.equal(await plugin.checkConnection(), true);
    same(plugin.backend, live);
    assert.equal(live.state, 'ready');
    const originalProvider = plugin.data.assistant.provider;
    assert.equal(await plugin.checkConnection('chatgpt'), true);
    same(plugin.backend, live);
    assert.equal(plugin.data.assistant.provider, originalProvider);
    assert.equal(live.state, 'ready');
    await send('@chatgpt follow up');
    await tick();
    assert.equal(asked.at(-1).provider, 'chatgpt');
    assert.equal(asked.at(-1).text.conversationHistory.length, 2);
    const current = plugin.backend;
    const factory = plugin.createBackend;
    plugin.connectionLabels.set('claude', document.createElement('p'));
    plugin.createBackend = (provider = plugin.data.assistant.provider) => {
      const probe = factory(provider);
      if (provider === 'claude')
        probe.enable = async () => {
          throw new Error('Subscription login required');
        };
      return probe;
    };
    assert.equal(await plugin.checkConnection('claude'), false);
    assert.match(
      plugin.connectionLabels.get('claude').textContent,
      /Not connected.*Subscription login required/,
    );
    same(plugin.backend, current);
    assert.equal(plugin.data.assistant.provider, 'chatgpt');
    plugin.createBackend = factory;
    assert.equal(await plugin.checkConnection('claude'), true);
    assert.match(plugin.connectionLabels.get('claude').textContent, /^Ready/);
    same(plugin.backend, current);
    plugin.data.codex.enabled = false;
    plugin.configureCodex();
    assert.equal(await plugin.checkConnection(), true);
    assert.equal(plugin.data.codex.enabled, false);
    same(plugin.backend, null);
  } finally {
    plugin.onunload();
    await tick();
  }
});

test('slash skills filter, complete without sending, and route the selected skill to Codex', async () => {
  const type = (input, value) => {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const key = (input, key) =>
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key, cancelable: true, bubbles: true }));
  const plugin = new Plugin();
  await plugin.onload();
  const skill = {
    name: 'synthetic-review',
    path: '/fixture/SKILL.md',
    description: 'Review a passage',
    enabled: true,
  };
  plugin.loadSkills = async () => [skill];
  let selected;
  plugin.createBackend = () => ({
    state: 'ready',
    detail: '',
    model: 'test',
    async enable() {},
    disable() {},
    async session() {
      return 'skill-session';
    },
    async ask(id, text, delta, finish, chosen) {
      selected = chosen;
      delta('Skill answer');
      finish('completed');
    },
  });
  plugin.data.codex.enabled = true;
  plugin.configureCodex();
  try {
    plugin.compose({
      kind: 'editor',
      path: 'test.md',
      anchor: { from: 0, to: 7, quote: 'passage', prefix: '', suffix: '', orphaned: false },
      text: () => 'passage',
    });
    const input = document.querySelector('.annotate-composer textarea');
    type(input, '/synthetic');
    await tick();
    assert.equal(
      document.querySelector('.annotate-mention-menu').hidden,
      true,
      'bare slash stays ordinary text',
    );
    type(input, '@claude /synthetic');
    await tick();
    assert.equal(
      document.querySelector('.annotate-mention-menu').hidden,
      false,
      'Claude mention also opens the skill picker',
    );
    type(input, '@chatgpt /synthetic');
    await tick();
    const menu = document.querySelector('.annotate-mention-menu');
    assert.equal(menu.hidden, false);
    assert.equal(menu.querySelector('strong').textContent, '/synthetic-review');
    key(input, 'Tab');
    assert.equal(input.value, '@chatgpt /synthetic-review ');
    assert.equal(plugin.data.threads.length, 0);
    await send('@chatgpt /synthetic-review explain');
    await tick();
    assert.equal(selected, skill);
    assert.equal(plugin.data.assistant.provider, 'chatgpt');
    assert.equal(plugin.data.threads[0].comments.at(-1).body, 'Skill answer');
    const reply = document.querySelector('.annotate-composer textarea');
    type(reply, '@chatgpt /synthetic');
    await tick();
    key(reply, 'Escape');
    assert.equal(document.querySelector('.annotate-mention-menu').hidden, true);
    assert.ok(document.querySelector('.annotate-popover'), 'Escape dismisses the picker first');
    type(reply, '@chatgpt /synthetic');
    type(reply, 'ordinary text');
    await tick();
    assert.equal(
      document.querySelector('.annotate-mention-menu').hidden,
      true,
      'stale discovery does not reopen menu',
    );
    selected = undefined;
    await send('/synthetic-review ordinary comment');
    await tick();
    assert.equal(selected, undefined, 'bare slash never invokes the assistant');
    assert.equal(plugin.data.threads[0].comments.at(-1).body, '/synthetic-review ordinary comment');
  } finally {
    plugin.onunload();
    await tick();
  }
});

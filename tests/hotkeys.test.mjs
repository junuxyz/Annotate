import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Window } from 'happy-dom';

const directory = mkdtempSync(join(tmpdir(), 'annotate-hotkeys-'));
const output = join(directory, 'hotkeys.cjs');
await build({
  entryPoints: ['src/hotkeys.ts'],
  bundle: true,
  outfile: output,
  platform: 'node',
  format: 'cjs',
  alias: { obsidian: resolve('tests/host.mjs') },
});
const { ShortcutManager, captureShortcut, formatShortcut, sameShortcut } = createRequire(
  import.meta.url,
)(output);
after(() => rmSync(directory, { recursive: true, force: true }));
const first = { modifiers: ['Mod', 'Shift'], key: 'j' };
const second = { modifiers: ['Mod', 'Alt'], key: 'k' };

class NativeHotkeys {
  defaults = { 'annotate:color': [first] };
  custom = { 'other:command': [second] };
  saved;
  fail = false;
  getHotkeys(id) {
    return this.custom[id];
  }
  getDefaultHotkeys(id) {
    return this.defaults[id];
  }
  setHotkeys(id, shortcuts) {
    this.custom[id] = shortcuts;
  }
  removeHotkeys(id) {
    delete this.custom[id];
  }
  async save() {
    if (this.fail) throw new Error('Storage unavailable');
    this.saved = JSON.stringify(this.custom);
  }
}

test('shortcut edits use native overrides, preserve multiple bindings and other commands, and reset defaults', async () => {
  const native = new NativeHotkeys();
  const manager = new ShortcutManager(native);
  assert.deepEqual(manager.current('annotate:color'), [first]);
  await manager.set('annotate:color', [first, second]);
  assert.deepEqual(manager.current('annotate:color'), [first, second]);
  assert.deepEqual(JSON.parse(native.saved)['other:command'], [second]);
  await manager.set('annotate:color', []);
  assert.deepEqual(manager.current('annotate:color'), []);
  await manager.set('annotate:color', null);
  assert.deepEqual(manager.current('annotate:color'), [first]);
  assert.equal(Object.hasOwn(JSON.parse(native.saved), 'annotate:color'), false);
});

test('failed shortcut persistence restores the previous native binding', async () => {
  const native = new NativeHotkeys();
  const manager = new ShortcutManager(native);
  await manager.set('annotate:color', [second]);
  native.fail = true;
  await assert.rejects(manager.set('annotate:color', [first]), /Storage unavailable/);
  assert.deepEqual(manager.current('annotate:color'), [second]);
  await assert.rejects(manager.set('annotate:color', null), /Storage unavailable/);
  assert.deepEqual(manager.current('annotate:color'), [second]);
});

test('unsupported hosts and malformed native bindings fail before changing configuration', async () => {
  assert.throws(() => new ShortcutManager({}));
  const native = new NativeHotkeys();
  const manager = new ShortcutManager(native);
  await assert.rejects(manager.set('annotate:color', [{ modifiers: ['invalid'], key: 'j' }]));
  assert.deepEqual(manager.current('annotate:color'), [first]);
  assert.equal(native.saved, undefined);
});

test('recording handles modifiers, Escape, function keys, IME, and physical letter keys on both platforms', () => {
  const win = new Window();
  const event = (options) => new win.KeyboardEvent('keydown', options);
  assert.equal(captureShortcut(event({ key: 'Escape' }), false).kind, 'cancel');
  assert.equal(captureShortcut(event({ key: 'Shift', shiftKey: true }), false).kind, 'ignore');
  assert.equal(
    captureShortcut(event({ key: 'j', isComposing: true, ctrlKey: true }), false).kind,
    'ignore',
  );
  assert.equal(captureShortcut(event({ key: 'j' }), false).kind, 'invalid');
  assert.equal(captureShortcut(event({ key: 'F8' }), false).kind, 'shortcut');
  const windows = captureShortcut(
    event({ key: 'ㅓ', code: 'KeyJ', ctrlKey: true, shiftKey: true }),
    false,
  );
  assert.equal(windows.kind, 'shortcut');
  assert.equal(formatShortcut(windows.shortcut, false), 'Ctrl+Shift+J');
  const mac = captureShortcut(
    event({ key: 'J', code: 'KeyJ', metaKey: true, shiftKey: true }),
    true,
  );
  assert.equal(mac.kind, 'shortcut');
  assert.equal(formatShortcut(mac.shortcut, true), 'Cmd+Shift+J');
  assert.equal(sameShortcut(mac.shortcut, first, true), true);
  assert.equal(sameShortcut(windows.shortcut, first, false), true);
  assert.equal(sameShortcut(first, { modifiers: ['Ctrl', 'Shift'], key: 'J' }, false), true);
  assert.equal(sameShortcut(first, { modifiers: ['Ctrl', 'Shift'], key: 'J' }, true), false);
});

test('unassigned defaults retain existing user overrides until explicitly cleared', async () => {
  const native = new NativeHotkeys();
  native.defaults = {};
  native.custom['annotate:color'] = [first];
  const manager = new ShortcutManager(native);
  assert.deepEqual(manager.current('annotate:color'), [first]);
  assert.deepEqual(manager.current('annotate:fresh-command'), []);
  await manager.set('annotate:color', null);
  assert.deepEqual(manager.current('annotate:color'), []);
  assert.deepEqual(native.custom['other:command'], [second]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installOffscreenGuards } from '../e2e/macos/guards.cjs';

function fixture() {
  const app = new EventEmitter();
  app.whenReady = () => Promise.resolve();
  let requestHandler, checkHandler;
  const session = {
    setPermissionRequestHandler(fn) {
      requestHandler = fn;
    },
    setPermissionCheckHandler(fn) {
      checkHandler = fn;
    },
  };
  const nativeCall = () => {
    throw new Error('Native API must not be reached');
  };
  const electron = {
    Menu: class {
      popup() {
        return nativeCall();
      }
    },
    app,
    session: { defaultSession: session },
    dialog: {},
    systemPreferences: { askForMediaAccess: nativeCall },
    globalShortcut: { register: nativeCall, registerAll: nativeCall },
    shell: { openExternal: nativeCall, openPath: nativeCall, showItemInFolder: nativeCall },
  };
  for (const method of [
    'showMessageBoxSync',
    'showMessageBox',
    'showOpenDialogSync',
    'showSaveDialogSync',
    'showOpenDialog',
    'showSaveDialog',
    'showErrorBox',
  ]) {
    electron.dialog[method] = nativeCall;
  }
  installOffscreenGuards(electron);
  return { electron, session, handlers: () => ({ requestHandler, checkHandler }) };
}

test('file dialogs cancel with Electron-compatible return types', async () => {
  const { electron: e } = fixture();
  assert.equal(e.dialog.showOpenDialogSync({}), undefined);
  assert.equal(e.dialog.showSaveDialogSync({}), '');
  assert.deepEqual(await e.dialog.showOpenDialog({}), { canceled: true, filePaths: [] });
  assert.deepEqual(await e.dialog.showSaveDialog({}), { canceled: true, filePath: '' });
  assert.equal(e.dialog.showErrorBox('Synthetic', 'Synthetic'), undefined);
});

test('message dialogs select cancellation and reject ambiguous choices', async () => {
  const { electron: e } = fixture();
  assert.equal(e.dialog.showMessageBoxSync({ buttons: ['Cancel', 'Delete'] }), 0);
  assert.equal(e.dialog.showMessageBoxSync({ buttons: ['Delete', '취소'] }), 1);
  assert.equal(e.dialog.showMessageBoxSync({}, { buttons: ['Skip', 'Proceed'], cancelId: 0 }), 0);
  assert.deepEqual(await e.dialog.showMessageBox({ buttons: ['Delete', 'Cancel'] }), {
    response: 1,
    checkboxChecked: false,
  });
  assert.throws(() => e.dialog.showMessageBoxSync({ buttons: ['Delete'] }), /explicit cancel/);
  await assert.rejects(e.dialog.showMessageBox({ buttons: ['Delete'] }), /explicit cancel/);
});

test('media access, external apps and global shortcuts never reach native APIs', async () => {
  const { electron: e } = fixture();
  for (const kind of ['microphone', 'camera'])
    assert.equal(await e.systemPreferences.askForMediaAccess(kind), false);
  assert.equal(
    e.globalShortcut.register('F24', () => {}),
    false,
  );
  assert.equal(
    e.globalShortcut.registerAll(['F24'], () => {}),
    undefined,
  );
  assert.equal(await e.shell.openExternal('https://example.org'), undefined);
  assert.match(await e.shell.openPath('/synthetic'), /disabled/);
  assert.equal(e.shell.showItemInFolder('/synthetic'), undefined);
  assert.throws(() => {
    e.systemPreferences.askForMediaAccess = () => Promise.resolve(true);
  }, TypeError);
});

test('existing and new sessions deny permissions even after handler replacement', async () => {
  const { electron: e, session, handlers } = fixture();
  await Promise.resolve();
  session.setPermissionRequestHandler((_web, _permission, cb) => cb(true));
  session.setPermissionCheckHandler(() => true);
  let granted;
  handlers().requestHandler(null, 'media', (value) => {
    granted = value;
  });
  assert.equal(granted, false);
  assert.equal(handlers().checkHandler(), false);
  let newRequest, newCheck;
  const partition = {
    setPermissionRequestHandler(fn) {
      newRequest = fn;
    },
    setPermissionCheckHandler(fn) {
      newCheck = fn;
    },
  };
  e.app.emit('session-created', partition);
  e.app.emit('session-created', partition);
  newRequest(null, 'notifications', (value) => {
    granted = value;
  });
  assert.equal(granted, false);
  assert.equal(newCheck(), false);
  assert.throws(() => {
    partition.setPermissionCheckHandler = () => true;
  }, TypeError);
});

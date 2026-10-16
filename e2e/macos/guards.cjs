'use strict';

function installOffscreenGuards(electron, audit = () => {}) {
  const replace = (target, name, fn) => {
    Object.defineProperty(target, name, { value: fn, writable: false, configurable: false });
  };
  const canceledMessage = (args) => {
    const options = args[args.length - 1] || {};
    const buttons = options.buttons || [];
    const cancel =
      Number.isInteger(options.cancelId) &&
      options.cancelId >= 0 &&
      options.cancelId < buttons.length
        ? options.cancelId
        : buttons.findIndex((label) =>
            /^(cancel|no|deny|취소|아니요|거부)$/iu.test(label.replaceAll('&', '').trim()),
          );
    if (cancel < 0)
      throw new Error('Offscreen test blocked message box without an explicit cancel choice');
    return cancel;
  };
  replace(electron.dialog, 'showMessageBoxSync', (...args) => {
    audit('blocked dialog.showMessageBoxSync');
    return canceledMessage(args);
  });
  replace(electron.dialog, 'showMessageBox', async (...args) => {
    audit('blocked dialog.showMessageBox');
    return { response: canceledMessage(args), checkboxChecked: false };
  });
  for (const [name, result] of [
    ['showOpenDialogSync', () => undefined],
    ['showSaveDialogSync', () => ''],
    ['showOpenDialog', async () => ({ canceled: true, filePaths: [] })],
    ['showSaveDialog', async () => ({ canceled: true, filePath: '' })],
    ['showErrorBox', () => undefined],
  ]) {
    replace(electron.dialog, name, (...args) => {
      audit('blocked dialog.' + name);
      return result(...args);
    });
  }
  replace(electron.systemPreferences, 'askForMediaAccess', async () => {
    audit('blocked systemPreferences.askForMediaAccess');
    return false;
  });
  replace(electron.Menu.prototype, 'popup', function (options = {}) {
    audit('blocked Menu.popup');
    options.callback?.();
  });
  for (const method of ['setAsDefaultProtocolClient', 'removeAsDefaultProtocolClient']) {
    replace(electron.app, method, () => {
      audit('blocked app.' + method);
      return false;
    });
  }
  replace(electron.globalShortcut, 'register', () => {
    audit('blocked globalShortcut.register');
    return false;
  });
  replace(electron.globalShortcut, 'registerAll', () =>
    audit('blocked globalShortcut.registerAll'),
  );
  replace(electron.shell, 'openExternal', async () => {
    audit('blocked shell.openExternal');
  });
  replace(electron.shell, 'openPath', async () => {
    audit('blocked shell.openPath');
    return 'External application opening is disabled in offscreen tests';
  });
  replace(electron.shell, 'showItemInFolder', () => audit('blocked shell.showItemInFolder'));

  const guardedSessions = new WeakSet();
  const guardSession = (session) => {
    if (guardedSessions.has(session)) return;
    guardedSessions.add(session);
    const request = session.setPermissionRequestHandler.bind(session);
    const check = session.setPermissionCheckHandler.bind(session);
    const denyRequest = (_contents, _permission, callback) => {
      audit('denied session permission request');
      callback(false);
    };
    const denyCheck = () => {
      audit('denied session permission check');
      return false;
    };
    replace(session, 'setPermissionRequestHandler', () => request(denyRequest));
    replace(session, 'setPermissionCheckHandler', () => check(denyCheck));
    session.setPermissionRequestHandler();
    session.setPermissionCheckHandler();
    audit('guarded session');
  };
  electron.app.on('session-created', guardSession);
  electron.app.whenReady().then(() => guardSession(electron.session.defaultSession));
}

module.exports = { installOffscreenGuards };

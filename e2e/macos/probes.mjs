export async function verifyGuards(client) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(${async function () {
      const e = require('@electron/remote');
      const windows = e.BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        offscreen: w.webContents.isOffscreen(),
        visible: w.isVisible(),
        opacity: w.getOpacity(),
        bounds: w.getBounds(),
      }));
      if (windows.some((w) => !w.offscreen || w.visible || w.opacity !== 0))
        throw Error('Unsafe initial windows ' + JSON.stringify(windows));
      const expect = (value, label) => {
        if (!value) throw Error(label);
      };
      expect(
        e.dialog.showMessageBoxSync({ buttons: ['Cancel', 'Delete'] }) === 0,
        'sync message cancellation',
      );
      expect(e.dialog.showOpenDialogSync({}) === undefined, 'sync open cancellation');
      expect(e.dialog.showSaveDialogSync({}) === '', 'sync save cancellation');
      expect(
        (await e.dialog.showMessageBox({ buttons: ['Delete', 'Cancel'] })).response === 1,
        'async message cancellation',
      );
      expect((await e.dialog.showOpenDialog({})).canceled, 'async open cancellation');
      expect((await e.dialog.showSaveDialog({})).canceled, 'async save cancellation');
      let blocked = false;
      try {
        e.dialog.showMessageBoxSync({ buttons: ['Delete'] });
      } catch {
        blocked = true;
      }
      expect(blocked, 'ambiguous message must fail');
      e.dialog.showErrorBox('Synthetic', 'Must not appear');
      expect(
        (await e.systemPreferences.askForMediaAccess('microphone')) === false,
        'microphone denial',
      );
      expect((await e.systemPreferences.askForMediaAccess('camera')) === false, 'camera denial');
      await e.shell.openExternal('https://example.org/synthetic-login');
      expect(!!(await e.shell.openPath('/synthetic/not-a-file')), 'external file denial');
      e.shell.showItemInFolder('/synthetic/not-a-file');
      const menu = e.Menu.buildFromTemplate([{ label: 'Synthetic' }]);
      await new Promise((resolve) => menu.popup({ callback: resolve }));
      expect(
        e.app.setAsDefaultProtocolClient('obsidian') === false,
        'protocol registration denial',
      );
      expect(e.app.removeAsDefaultProtocolClient('obsidian') === false, 'protocol removal denial');
      const accelerator = 'CommandOrControl+Alt+Shift+F24';
      expect(e.globalShortcut.register(accelerator, () => {}) === false, 'shortcut denial');
      e.globalShortcut.registerAll([accelerator], () => {});
      expect(!e.globalShortcut.isRegistered(accelerator), 'shortcut registration escaped');
      e.session.defaultSession.setPermissionCheckHandler(() => true);
      expect(
        (await navigator.permissions.query({ name: 'notifications' })).state === 'denied',
        'default session denial',
      );
      const second = new e.BrowserWindow({
        show: true,
        webPreferences: { partition: 'offscreen-probe' },
      });
      try {
        second.webContents.session.setPermissionRequestHandler(null);
        second.webContents.session.setPermissionCheckHandler(() => true);
        await second.loadURL('data:text/html,<title>Synthetic isolation probe</title>');
        second.setSize(1600, 1000);
        second.setPosition(0, 0);
        second.setOpacity(1);
        second.setFocusable(true);
        second.setIgnoreMouseEvents(false);
        expect(
          second.getBounds().x === -30000 &&
            second.getBounds().y === -30000 &&
            second.getOpacity() === 0,
          'resize or move escaped',
        );
        second.show();
        second.focus();
        expect(
          !second.isVisible() && !second.isFocused() && second.webContents.isOffscreen(),
          'window escaped',
        );
        expect(
          (await second.webContents.executeJavaScript(
            'navigator.permissions.query({name:"notifications"}).then(p=>p.state)',
          )) === 'denied',
          'new session denial',
        );
      } finally {
        second.destroy();
      }
      const storage = e.safeStorage;
      expect(
        storage.decryptString(storage.encryptString('synthetic')) === 'synthetic',
        'mock storage round trip',
      );
      return [
        'sync and async dialogs canceled',
        'ambiguous message rejected',
        'media permissions denied',
        'external applications blocked',
        'global shortcuts blocked',
        'existing and new session permissions denied',
        'native menus suppressed',
        'new windows remain offscreen',
        'mock storage round trip',
      ];
    }})()`,
  });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

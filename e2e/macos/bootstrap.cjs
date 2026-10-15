(() => {
  'use strict';
  const fs = require('node:fs');
  const Module = require('node:module');
  const config = JSON.parse(fs.readFileSync(process.env.OBSIDIAN_OFFSCREEN_CONFIG, 'utf8'));
  const load = Module._load;
  const electron = load('electron', module, false);
  const { app } = electron;
  const audit = (event) => fs.appendFileSync(config.audit, JSON.stringify({ event }) + '\n');
  const fail = (error) => {
    audit({ fatal: String(error.stack || error) });
    app.exit(1);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  app.setPath('userData', config.profile);
  app.setPath('sessionData', config.session);
  app.setPath('home', config.home);
  app.disableHardwareAcceleration();
  const policy = app.setActivationPolicy.bind(app);
  policy('prohibited');
  app.setActivationPolicy = () => policy('prohibited');
  for (const method of ['focus', 'show', 'bounce'])
    app[method] = () => audit('blocked app.' + method);
  if (app.dock) {
    app.dock.show = () => Promise.resolve();
    app.dock.bounce = () => -1;
  }
  app.commandLine.appendSwitch('use-mock-keychain');
  app.commandLine.appendSwitch('remote-debugging-port', String(config.port));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  const Window = new Proxy(electron.BrowserWindow, {
    construct(Target, args, newTarget) {
      const options = args[0] || {};
      const win = Reflect.construct(
        Target,
        [
          {
            ...options,
            show: false,
            focusable: false,
            webPreferences: {
              ...options.webPreferences,
              offscreen: true,
              backgroundThrottling: false,
            },
          },
        ],
        newTarget,
      );
      for (const method of ['show', 'showInactive', 'focus', 'restore', 'moveTop'])
        win[method] = () => audit('blocked window.' + method);
      const bounds = win.setBounds.bind(win);
      const opacity = win.setOpacity.bind(win);
      const focusable = win.setFocusable.bind(win);
      const mouse = win.setIgnoreMouseEvents.bind(win);
      opacity(0);
      focusable(false);
      mouse(true);
      bounds({ ...win.getBounds(), x: -30000, y: -30000 }, false);
      win.setBounds = (value) => bounds({ ...value, x: -30000, y: -30000 }, false);
      win.setPosition = () => bounds({ ...win.getBounds(), x: -30000, y: -30000 }, false);
      win.setSize = (width, height) => win.setBounds({ ...win.getBounds(), width, height });
      win.setOpacity = () => opacity(0);
      win.setFocusable = () => focusable(false);
      win.setIgnoreMouseEvents = () => mouse(true);
      for (const method of ['center', 'setFullScreen', 'setSimpleFullScreen', 'setKiosk'])
        win[method] = () => audit('blocked window.' + method);
      win.webContents.setBackgroundThrottling(false);
      win.webContents.setFrameRate(15);
      audit({
        createdWindow: win.id,
        offscreen: win.webContents.isOffscreen(),
        opacity: win.getOpacity(),
        bounds: win.getBounds(),
      });
      win.webContents.setWindowOpenHandler(() => {
        audit('blocked renderer popup');
        return { action: 'deny' };
      });
      return win;
    },
  });
  const guards = (() => {
    const module = { exports: {} };
    /* OFFSCREEN_GUARDS */
    return module.exports;
  })();
  guards.installOffscreenGuards(electron, audit);
  const proxy = new Proxy(electron, {
    get: (target, key) => (key === 'BrowserWindow' ? Window : Reflect.get(target, key)),
  });
  Module._load = function (request, parent, isMain) {
    return request === 'electron' || request === 'electron/main'
      ? proxy
      : load.call(this, request, parent, isMain);
  };
  Object.defineProperty(app, '__offscreenTest', {
    value: { token: config.token, profile: config.profile },
  });
  app
    .whenReady()
    .then(() => {
      policy('prohibited');
      audit('ready');
    })
    .catch(fail);
  audit('bootstrap installed');
})();

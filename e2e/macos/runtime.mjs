import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { dirname, join, resolve, basename, relative } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readArchive, prependMain, disableTestCookieEncryption, sha256 } from './asar.mjs';
import { verifyGuards } from './probes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(readFileSync(join(HERE, 'compatibility.json')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plist = (file, key) =>
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file], {
    encoding: 'utf8',
  }).trim();

export function checkCompatibility(actual, expected = pin) {
  for (const key of Object.keys(expected))
    if (actual[key] !== expected[key])
      throw Error(
        `Unsupported Obsidian runtime: ${key} is ${actual[key]}, expected ${expected[key]}. No app launched. Inspect with npm run check:compat; review and revalidate compatibility.json after an update.`,
      );
}

export function inspectInstallation() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error(
      'Native offscreen checks currently require macOS Apple silicon. No desktop fallback.',
    );
  const bundle = process.env.OBSIDIAN_APP || '/Applications/Obsidian.app';
  const archive =
    process.env.OBSIDIAN_APP_ASAR ||
    join(homedir(), 'Library/Application Support/obsidian', `obsidian-${pin.app}.asar`);
  const loaderFile = join(bundle, 'Contents/Resources/app.asar');
  const loaderBytes = readFileSync(loaderFile);
  const loader = JSON.parse(readArchive(loaderBytes).entry('package.json')).version;
  const actual = {
    platform: process.platform,
    arch: process.arch,
    macOS: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
    electron: plist(
      join(
        bundle,
        'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist',
      ),
      'CFBundleVersion',
    ),
    loader,
    app: JSON.parse(readArchive(readFileSync(archive)).entry('package.json')).version,
    loaderSha256: sha256(loaderBytes),
    appSha256: sha256(readFileSync(archive)),
  };
  // An installed newer archive is an update even if the older pinned archive remains on disk.
  if (!process.env.OBSIDIAN_APP_ASAR) {
    const { readdirSync } = process.getBuiltinModule('node:fs');
    const versions = readdirSync(dirname(archive))
      .flatMap((name) => {
        const match = /^obsidian-(\d+)\.(\d+)\.(\d+)\.asar$/.exec(name);
        return match ? [{ name, version: match.slice(1).map(Number) }] : [];
      })
      .sort(
        (a, b) =>
          b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2],
      );
    if (versions[0] && versions[0].name !== basename(archive))
      actual.app = versions[0].version.join('.');
  }
  return { actual, bundle, archive };
}

export async function freePort(requested) {
  if (
    requested !== undefined &&
    (!/^\d+$/.test(String(requested)) || +requested < 1024 || +requested > 65535)
  )
    throw Error('CDP port must be between 1024 and 65535');
  const server = createServer();
  await new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(requested === undefined ? 0 : +requested, '127.0.0.1', resolvePort);
  });
  const port = server.address().port;
  await new Promise((r, reject) => server.close((e) => (e ? reject(e) : r())));
  return port;
}

export async function connectPage(port) {
  const pages = await (
    await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })
  ).json();
  const page = pages.find(
    (p) => p.type === 'page' && p.url.startsWith('app://') && p.title.includes('test-vault'),
  );
  if (!page) throw Error('No synthetic test-vault page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await Promise.race([
    once(ws, 'open'),
    sleep(2000).then(() => {
      throw Error('CDP connection timeout');
    }),
  ]);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  return {
    close: () => ws.close(),
    send: (method, params = {}) =>
      new Promise((resolveCommand, reject) => {
        const key = ++id;
        const timeout = setTimeout(() => {
          pending.delete(key);
          reject(Error(`CDP timeout: ${method}`));
        }, 10_000);
        pending.set(key, (message) => {
          clearTimeout(timeout);
          if (message.error) reject(Error(JSON.stringify(message.error)));
          else resolveCommand(message.result);
        });
        ws.send(JSON.stringify({ id: key, method, params }));
      }),
  };
}

function prepareBundle(installation, cache) {
  const bootstrap = readFileSync(join(HERE, 'bootstrap.cjs'), 'utf8').replace(
    '/* OFFSCREEN_GUARDS */',
    () => readFileSync(join(HERE, 'guards.cjs'), 'utf8'),
  );
  const key = sha256(
    JSON.stringify(installation.actual) +
      bootstrap +
      readFileSync(join(HERE, 'monitor.swift')) +
      readFileSync(join(HERE, 'asar.mjs')) +
      readFileSync(fileURLToPath(import.meta.url)),
  ).slice(0, 20);
  const root = join(cache, key),
    bundle = join(root, 'Obsidian-Offscreen.app');
  const receipt = join(root, 'receipt.json');
  if (existsSync(receipt)) {
    const saved = JSON.parse(readFileSync(receipt));
    if (saved.archive !== sha256(readFileSync(join(bundle, 'Contents/Resources/app.asar'))))
      throw Error('Cached test application changed; remove its cache and retry.');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
      stdio: 'pipe',
    });
    return { root, bundle };
  }
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  execFileSync('/bin/cp', ['-cR', installation.bundle, bundle]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
  if (
    sha256(readFileSync(join(bundle, 'Contents/Resources/app.asar'))) !==
    installation.actual.loaderSha256
  )
    throw Error('Obsidian loader changed during preparation; no app launched.');
  const info = join(bundle, 'Contents/Info.plist');
  for (const command of [
    `Set :CFBundleIdentifier local.obsidian.offscreen.${key}`,
    'Add :LSBackgroundOnly bool true',
    'Add :LSUIElement bool true',
    'Delete :ElectronAsarIntegrity',
  ])
    execFileSync('/usr/libexec/PlistBuddy', ['-c', command, info]);
  const appArchive = join(bundle, 'Contents/Resources/app.asar');
  writeFileSync(appArchive, prependMain(readFileSync(appArchive), bootstrap, true));
  const framework = join(
    bundle,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  );
  writeFileSync(framework, disableTestCookieEncryption(readFileSync(framework)));
  const entitlements = join(root, 'entitlements.plist');
  writeFileSync(
    entitlements,
    '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>',
  );
  execFileSync(
    '/usr/bin/codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--options',
      'runtime',
      '--entitlements',
      entitlements,
      bundle,
    ],
    { stdio: 'pipe' },
  );
  execFileSync('/usr/bin/swiftc', [join(HERE, 'monitor.swift'), '-o', join(root, 'monitor')], {
    stdio: 'pipe',
  });
  writeFileSync(
    receipt,
    JSON.stringify({ ...installation.actual, archive: sha256(readFileSync(appArchive)) }),
  );
  return { root, bundle };
}

export async function startOffscreen({ profile, port, evidence, cache }) {
  const installation = inspectInstallation();
  checkCompatibility(installation.actual);
  profile = resolve(profile);
  if (!/^(annotate-offscreen-|obsidian-clippings-(check|perf)-)/.test(basename(dirname(profile))))
    throw Error('Profile must belong to a fresh managed test run');
  const underTemp = relative(tmpdir(), profile);
  if (
    underTemp.startsWith('..') ||
    underTemp.startsWith('/') ||
    !underTemp ||
    basename(profile) !== 'profile'
  )
    throw Error('Offscreen profile must be a private temporary directory named profile');
  if (
    lstatSync(profile).isSymbolicLink() ||
    !lstatSync(profile).isDirectory() ||
    !realpathSync(profile).startsWith(realpathSync(tmpdir()) + '/')
  )
    throw Error('Profile must be an actual private temporary directory, not a symlink');
  const settings = JSON.parse(readFileSync(join(profile, 'obsidian.json')));
  const vaults = Object.values(settings.vaults || {});
  if (
    vaults.length !== 1 ||
    basename(vaults[0].path) !== 'test-vault' ||
    !resolve(vaults[0].path).startsWith(dirname(profile) + '/')
  )
    throw Error('Only one synthetic sibling test-vault is allowed');
  if (!realpathSync(vaults[0].path).startsWith(realpathSync(dirname(profile)) + '/'))
    throw Error('Synthetic vault must not resolve outside the temporary run');

  await freePort(port);
  const prepared = prepareBundle(installation, cache);
  mkdirSync(evidence, { recursive: true });
  const run = mkdtempSync(join(tmpdir(), 'obsidian-offscreen-run-'));
  const home = join(run, 'home'),
    session = join(run, 'session');
  mkdirSync(home);
  mkdirSync(session);
  copyFileSync(installation.archive, join(profile, basename(installation.archive)));
  if (
    sha256(readFileSync(join(profile, basename(installation.archive)))) !==
    installation.actual.appSha256
  )
    throw Error('Obsidian archive changed during preparation; no app launched.');
  const audit = join(evidence, 'offscreen-audit.jsonl');
  const token = randomUUID();
  const configPath = join(run, 'config.json');
  writeFileSync(configPath, JSON.stringify({ profile, home, session, port, audit, token }), {
    mode: 0o600,
  });
  let app, monitor, stopped, client;
  const kill = (child) => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try {
        if (child === monitor) child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  const emergencyStop = () => {
    kill(app);
    kill(monitor);
  };
  process.once('exit', emergencyStop);
  const interrupted = () => {
    emergencyStop();
    process.exit(130);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted);
  const output = openSync(join(evidence, 'obsidian-startup.log'), 'a');
  const monitorOutput = openSync(join(evidence, 'observer.log'), 'a');
  const metadata = {
    ...installation.actual,
    isolation: 'native macOS offscreen, prohibited activation, synthetic profile, mock Keychain',
  };
  const stop = async () => {
    if (stopped) return stopped;
    stopped = (async () => {
      client?.close();
      kill(app);
      if (app && app.exitCode === null && app.signalCode === null)
        await Promise.race([once(app, 'exit'), sleep(2000)]);
      writeFileSync(join(run, 'stop'), 'stop');
      for (let i = 0; i < 100 && !existsSync(join(run, 'results.json')); i++) await sleep(20);
      if (monitor && monitor.exitCode === null && monitor.signalCode === null)
        await Promise.race([once(monitor, 'exit'), sleep(2000)]);
      kill(monitor);
      process.removeListener('exit', emergencyStop);
      for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupted);
      if (!existsSync(join(run, 'results.json')))
        throw Error('Offscreen observer did not return evidence');
      const focus = JSON.parse(readFileSync(join(run, 'results.json')));
      writeFileSync(
        join(evidence, 'isolation.json'),
        JSON.stringify({ ...metadata, focus }, null, 2),
      );
      const violated = existsSync(join(run, 'violation'));
      rmSync(run, { recursive: true, force: true });
      rmSync(dirname(profile), { recursive: true, force: true });
      if (!focus.samples || focus.testAppActivations || focus.visibleWindowSamples || violated)
        throw Error('Offscreen isolation failed; see isolation.json');
      return { ...metadata, focus };
    })();
    return stopped;
  };
  try {
    monitor = spawn(join(prepared.root, 'monitor'), [run, prepared.bundle], {
      detached: true,
      stdio: ['ignore', monitorOutput, monitorOutput],
    });
    monitor.on('error', () => {});
    for (let i = 0; i < 250 && !existsSync(join(run, 'ready')); i++) {
      if (monitor.exitCode !== null) throw Error('Offscreen observer exited before launch');
      await sleep(20);
    }
    if (!existsSync(join(run, 'ready')))
      throw Error('Offscreen observer not ready; refusing launch');
    const env = {
      PATH: process.env.PATH,
      LANG: process.env.LANG || 'en_US.UTF-8',
      HOME: home,
      TMPDIR: run,
      CODEX_HOME: join(home, '.codex'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      OBSIDIAN_OFFSCREEN_CONFIG: configPath,
    };
    app = spawn(join(prepared.bundle, 'Contents/MacOS/Obsidian'), ['--use-mock-keychain'], {
      env,
      detached: true,
      stdio: ['ignore', output, output],
    });
    let spawnError;
    app.on('error', (error) => {
      spawnError = error;
    });
    writeFileSync(join(run, 'pid'), String(app.pid));
    const until = Date.now() + 45_000;
    while (Date.now() < until) {
      if (
        spawnError ||
        app.exitCode !== null ||
        app.signalCode !== null ||
        existsSync(join(run, 'violation'))
      )
        throw Error(`Offscreen application exited: ${spawnError || 'see obsidian-startup.log'}`);
      try {
        client = await connectPage(port);
        break;
      } catch {}
      await sleep(100);
    }
    if (!client) throw Error('Offscreen startup timed out');
    const result = await client.send('Runtime.evaluate', {
      expression: `JSON.stringify(require('@electron/remote').app.__offscreenTest)`,
      returnByValue: true,
    });
    const ownership = JSON.parse(result.result?.value || 'null');
    if (ownership?.token !== token || ownership.profile !== profile)
      throw Error('CDP endpoint is not owned by this test run');
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const probes = await verifyGuards(client);
    writeFileSync(
      join(evidence, 'guard-checks.json'),
      JSON.stringify({ ...metadata, probes }, null, 2),
    );
    client.close();
    client = null;
    console.log(
      `Offscreen Obsidian ${metadata.app}, Electron ${metadata.electron}; private test-vault`,
    );
    return { metadata, stop, port, profile };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  } finally {
    closeSync(output);
    closeSync(monitorOutput);
  }
}

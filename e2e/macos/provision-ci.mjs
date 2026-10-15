import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { checkCompatibility, inspectInstallation } from './runtime.mjs';

if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.platform !== 'darwin' ||
  !process.env.GITHUB_ENV
)
  throw Error('Provisioning is restricted to disposable macOS GitHub Actions runners.');
const pin = JSON.parse(readFileSync(new URL('./compatibility.json', import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'obsidian-ci-'));
const download = (version, name, target) =>
  execFileSync(
    '/usr/bin/curl',
    [
      '--fail',
      '--location',
      '--retry',
      '3',
      '--max-time',
      '180',
      '--output',
      target,
      `https://github.com/obsidianmd/obsidian-releases/releases/download/v${version}/${name}`,
    ],
    { stdio: 'inherit' },
  );
const image = join(root, 'installer.dmg'),
  mount = join(root, 'volume');
mkdirSync(mount);
download(pin.loader, `Obsidian-${pin.loader}.dmg`, image);
try {
  execFileSync(
    '/usr/bin/hdiutil',
    ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image],
    { stdio: 'inherit' },
  );
  execFileSync('/bin/cp', ['-R', join(mount, 'Obsidian.app'), join(root, 'Obsidian.app')]);
} finally {
  execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'inherit' });
}
const compressed = join(root, 'app.asar.gz');
download(pin.app, `obsidian-${pin.app}.asar.gz`, compressed);
const archive = join(root, `obsidian-${pin.app}.asar`);
writeFileSync(archive, gunzipSync(readFileSync(compressed)));
process.env.OBSIDIAN_APP = join(root, 'Obsidian.app');
process.env.OBSIDIAN_APP_ASAR = archive;
checkCompatibility(inspectInstallation().actual);
appendFileSync(
  process.env.GITHUB_ENV,
  `OBSIDIAN_APP=${process.env.OBSIDIAN_APP}\nOBSIDIAN_APP_ASAR=${archive}\n`,
);
console.log('Pinned Obsidian prepared without launching it.');

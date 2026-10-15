import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const releaseFiles = ['main.js', 'manifest.json', 'styles.css'];
const digest = (content) => createHash('sha256').update(content).digest('hex');
const read = (root, name) => readFileSync(resolve(root, name), 'utf8');

export function bundleBanner(root, development) {
  const manifest = read(root, 'manifest.json');
  const styles = read(root, 'styles.css');
  const legal = `${read(root, 'LICENSE').trim()}\n\n${read(root, 'THIRD_PARTY_NOTICES.md').trim()}`;
  if (legal.includes('*/'))
    throw new Error('License text cannot contain a JavaScript comment terminator.');
  return `/*! Annotate ${development ? 'development' : 'distribution'} build\nmanifest-sha256: ${digest(manifest)}\nstyles-sha256: ${digest(styles)}\n\n${legal}\n*/`;
}

export function verifyRelease(root, { tag, hashes } = {}) {
  const manifest = JSON.parse(read(root, 'manifest.json'));
  const pkg = JSON.parse(read(root, 'package.json'));
  const lock = JSON.parse(read(root, 'package-lock.json'));
  const versions = JSON.parse(read(root, 'versions.json'));
  if (manifest.id !== 'annotate') throw new Error('Release plugin id must be annotate.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Release version must be x.y.z.');
  if (
    manifest.version !== pkg.version ||
    manifest.version !== lock.version ||
    manifest.version !== lock.packages?.['']?.version ||
    versions[manifest.version] !== manifest.minAppVersion
  )
    throw new Error('Release versions or minimum app versions do not match.');
  if (tag !== undefined && tag !== manifest.version)
    throw new Error(`Release tag must be exactly ${manifest.version}, without a v prefix.`);
  const code = read(root, 'main.js');
  if (!code.startsWith(bundleBanner(root, false)))
    throw new Error(
      'Build is stale, a development build, or missing distribution license notices. Run npm run build.',
    );
  if (code.includes(resolve(root)) || /[\\/]\.development[\\/]/.test(code))
    throw new Error('Distribution contains an absolute development path.');
  const files = Object.fromEntries(
    releaseFiles.map((name) => [name, digest(readFileSync(resolve(root, name)))]),
  );
  if (hashes) {
    if (
      hashes.version !== manifest.version ||
      Object.keys(hashes.files ?? {}).length !== releaseFiles.length
    )
      throw new Error('Validated build hash record has a different version or file list.');
    for (const name of releaseFiles)
      if (hashes.files[name] !== files[name])
        throw new Error(`Validated build hash mismatch: ${name}`);
  }
  return { version: manifest.version, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index];
      const value = args[index + 1];
      if (!['--tag', '--hashes'].includes(flag) || !value)
        throw new Error(
          'Usage: npm run release:verify -- [--tag x.y.z] [--hashes validated-build.json]',
        );
      if (flag === '--tag') options.tag = value;
      else options.hashes = JSON.parse(readFileSync(value, 'utf8'));
    }
    console.log(JSON.stringify(verifyRelease(process.cwd(), options), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

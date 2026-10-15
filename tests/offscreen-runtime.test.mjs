import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { runInNewContext } from 'node:vm';
import { checkCompatibility, freePort } from '../e2e/macos/runtime.mjs';
import { readArchive, prependMain, disableTestCookieEncryption } from '../e2e/macos/asar.mjs';

const pin = JSON.parse(readFileSync(new URL('../e2e/macos/compatibility.json', import.meta.url)));
function archive(main = 'main') {
  const json = Buffer.from(
    JSON.stringify({
      files: {
        'main.js': { offset: '0', size: Buffer.byteLength(main) },
        nested: { files: { 'other.js': { offset: String(Buffer.byteLength(main)), size: 5 } } },
        external: { unpacked: true, size: 9 },
      },
    }),
  );
  const size = 8 + json.length + ((4 - (json.length % 4)) % 4);
  const header = Buffer.alloc(size + 8);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(size, 4);
  header.writeUInt32LE(size - 4, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  return Buffer.concat([header, Buffer.from(main + 'other')]);
}

test('unknown runtime versions and changed archives fail closed', () => {
  assert.doesNotThrow(() => checkCompatibility(pin));
  for (const key of Object.keys(pin))
    assert.throws(() => checkCompatibility({ ...pin, [key]: 'unexpected' }), /No app launched/);
});

test('archive bootstrap preserves nested file bytes and unpacked entries', () => {
  const original = archive();
  const result = readArchive(prependMain(original, 'bootstrap();'));
  assert.equal(result.entry('main.js').toString(), 'bootstrap();\nmain');
  assert.equal(result.entry('nested/other.js').toString(), 'other');
  assert.equal(result.header.files.external.unpacked, true);
  assert.equal(readArchive(original).entry('main.js').toString(), 'main');
  assert.throws(() => readArchive(Buffer.from('bad')), /Invalid/);
  assert.throws(() => result.entry('missing'), /Invalid/);
});

test('fuse patch changes only the disposable input copy and rejects unknown layouts', () => {
  const marker = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  const original = Buffer.concat([marker, Buffer.from([1, 8]), Buffer.from('01000001')]);
  const changed = disableTestCookieEncryption(original);
  assert.equal(original[marker.length + 3], 49);
  assert.equal(changed[marker.length + 3], 48);
  assert.equal(changed.length, original.length);
  assert.throws(() => disableTestCookieEncryption(changed), /Expected enabled/);
  assert.throws(() => disableTestCookieEncryption(Buffer.from('unknown')), /Unsupported/);
  assert.throws(
    () => disableTestCookieEncryption(Buffer.concat([original, original])),
    /Unsupported/,
  );
});

test('owned debug port selection refuses an occupied endpoint', async () => {
  await assert.rejects(freePort('invalid'), /CDP port/);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(freePort(server.address().port), { code: 'EADDRINUSE' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('universal Mach-O patches each architecture and rejects overlapping slices', () => {
  const marker = Buffer.concat([
    Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
    Buffer.from([1, 8]),
    Buffer.from('01000001'),
  ]);
  const header = Buffer.alloc(48);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(2, 4);
  for (let i = 0; i < 2; i++) {
    header.writeUInt32BE(48 + marker.length * i, 16 + i * 20);
    header.writeUInt32BE(marker.length, 20 + i * 20);
  }
  const bytes = Buffer.concat([header, marker, marker]);
  const patched = disableTestCookieEncryption(bytes);
  for (let i = 0; i < 2; i++) {
    assert.equal(
      patched[48 + marker.length * i + Buffer.byteLength('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX') + 3],
      48,
    );
    assert.equal(
      bytes[48 + marker.length * i + Buffer.byteLength('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX') + 3],
      49,
    );
  }
  bytes.writeUInt32BE(48, 36);
  assert.throws(() => disableTestCookieEncryption(bytes), /Overlapping/);
});

test('the copied loader cannot update itself during manual checks or reloads', async () => {
  const original = 'async function update(manual) { globalThis.updated=true; }';
  const bytes = archive(original);
  const patched = readArchive(prependMain(bytes, '', true));
  const context = {};
  await runInNewContext(patched.entry('main.js').toString() + ';update(true);', context);
  assert.equal(context.updated, undefined);
  assert.equal(patched.entry('nested/other.js').toString(), 'other');
  assert.equal(readArchive(bytes).entry('main.js').toString(), original);
  assert.throws(() => prependMain(archive(), 'bootstrap', true), /Unsupported updater/);
});

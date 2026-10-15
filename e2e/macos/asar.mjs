import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function readArchive(bytes) {
  if (bytes.length < 16 || bytes.readUInt32LE(0) !== 4) throw Error('Invalid ASAR header');
  const headerSize = bytes.readUInt32LE(4);
  const jsonSize = bytes.readUInt32LE(12);
  if (headerSize > 8 * 1024 * 1024 || jsonSize + 8 > headerSize || 8 + headerSize > bytes.length)
    throw Error('Invalid ASAR header size');
  const header = JSON.parse(bytes.subarray(16, 16 + jsonSize).toString());
  const data = bytes.subarray(8 + headerSize);
  const entry = (name) => {
    const file = name.split('/').reduce((node, part) => node?.files?.[part], header);
    const offset = Number(file?.offset);
    if (
      !file ||
      file.unpacked ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      offset + file.size > data.length
    )
      throw Error(`Invalid packed ASAR entry: ${name}`);
    return data.subarray(offset, offset + file.size);
  };
  return { header, data, entry };
}

export function prependMain(bytes, bootstrap, freezeUpdates = false) {
  const { header, data, entry } = readArchive(bytes);
  const original = entry('main.js');
  let main = original;
  if (freezeUpdates) {
    const marker = 'async function update(manual) {';
    const code = original.toString();
    if (code.split(marker).length !== 2)
      throw Error('Unsupported updater entry point; refusing launch');
    main = Buffer.from(code.replace(marker, marker + '\nreturn;'));
  }

  const file = header.files['main.js'];
  const offset = Number(file.offset);
  const prefix = Buffer.from(bootstrap + '\n');
  const delta = prefix.length + main.length - original.length;
  const visit = (files) => {
    for (const node of Object.values(files)) {
      if (node.files) visit(node.files);
      else if (node.offset !== undefined && Number(node.offset) > offset)
        node.offset = String(Number(node.offset) + delta);
    }
  };
  visit(header.files);
  file.size = prefix.length + main.length;
  delete file.integrity;
  const json = Buffer.from(JSON.stringify(header));
  const size = 8 + json.length + ((4 - (json.length % 4)) % 4);
  const pickle = Buffer.alloc(size);
  pickle.writeUInt32LE(size - 4, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const preamble = Buffer.alloc(8);
  preamble.writeUInt32LE(4, 0);
  preamble.writeUInt32LE(size, 4);
  return Buffer.concat([
    preamble,
    pickle,
    data.subarray(0, offset),
    prefix,
    main,
    data.subarray(offset + original.length),
  ]);
}

export function disableTestCookieEncryption(bytes) {
  const marker = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  let slices = [[0, bytes.length]];
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0xcafebabe) {
    const count = bytes.readUInt32BE(4);
    if (count < 1 || count > 8 || 8 + count * 20 > bytes.length)
      throw Error('Unsupported Mach-O layout');
    slices = Array.from({ length: count }, (_, i) => {
      const offset = bytes.readUInt32BE(8 + i * 20 + 8);
      const size = bytes.readUInt32BE(8 + i * 20 + 12);
      if (offset < 8 + count * 20 || size < marker.length + 10 || offset + size > bytes.length)
        throw Error('Unsupported Mach-O slice');
      return [offset, offset + size];
    });
    if (
      slices.some(([start, end], i) =>
        slices.some(([otherStart, otherEnd], j) => i !== j && start < otherEnd && otherStart < end),
      )
    )
      throw Error('Overlapping Mach-O slices');
  }
  const patched = Buffer.from(bytes);
  for (const [start, end] of slices) {
    const slice = bytes.subarray(start, end);
    const offset = slice.indexOf(marker);
    if (
      offset < 0 ||
      slice.indexOf(marker, offset + 1) !== -1 ||
      slice[offset + marker.length] !== 1 ||
      slice[offset + marker.length + 1] !== 8
    )
      throw Error('Unsupported Electron fuse layout; refusing launch');
    const state = start + offset + marker.length + 3;
    if (bytes[state] !== 49) throw Error('Expected enabled cookie encryption in the original copy');
    patched[state] = 48;
  }
  return patched;
}

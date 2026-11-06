// Minimal reader for Electron's asar archives (the app.asar inside a packaged
// build), so the --built stealth pass can scan what actually ships.
//
// Layout (electron/asar, src/disk.ts): an 8-byte Chromium pickle holding the
// header size N, then an N-byte pickle holding the JSON header as a string
// (u32 payload size, u32 string length, UTF-8 JSON, padding), then the file
// data. Each file entry has { size, offset } with offset relative to 8 + N.
// Entries with `unpacked: true` live in app.asar.unpacked/ and are walked as
// ordinary files (the built pass fails if one was not); `link` entries are
// symlinks inside the archive.

/** Lists files in an asar buffer as { path, data } or { path, unpacked: true } / { path, link }. Throws on a malformed archive. */
export function readAsar(buf) {
  if (buf.length < 16 || buf.readUInt32LE(0) !== 4) throw new Error('not an asar archive');
  const headerSize = buf.readUInt32LE(4);
  const strLen = buf.readUInt32LE(12);
  if (16 + strLen > 8 + headerSize || 8 + headerSize > buf.length) throw new Error('asar header out of range');
  const header = JSON.parse(buf.subarray(16, 16 + strLen).toString('utf8'));
  const base = 8 + headerSize;
  const files = [];
  const visit = (node, prefix) => {
    for (const [name, entry] of Object.entries(node?.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.files) visit(entry, path);
      else if (entry.link !== undefined) files.push({ path, link: entry.link });
      else if (entry.unpacked) files.push({ path, unpacked: true });
      else {
        const start = base + Number(entry.offset);
        const end = start + Number(entry.size);
        if (!Number.isFinite(start) || end > buf.length || start < base) throw new Error(`asar entry ${path} out of range`);
        files.push({ path, data: buf.subarray(start, end) });
      }
    }
  };
  visit(header, '');
  return files;
}

/**
 * Builds an asar buffer from { 'dir/file.js': Buffer | string | { unpacked: true } }.
 * An { unpacked: true } value is listed in the header only, as electron-builder
 * does for asarUnpack files (their bytes live in app.asar.unpacked/). Used by tests.
 */
export function writeAsar(entries) {
  const header = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [path, content] of Object.entries(entries)) {
    const parts = path.split('/');
    let node = header;
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] ??= { files: {} };
      node = node.files[dir];
    }
    if (content?.unpacked === true) {
      node.files[parts.at(-1)] = { size: 0, unpacked: true };
      continue;
    }
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    node.files[parts.at(-1)] = { size: data.length, offset: String(offset) };
    offset += data.length;
    chunks.push(data);
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = Math.ceil(json.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle, ...chunks]);
}

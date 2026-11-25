/**
 * A minimal zip reader for Office documents: the central directory, then each
 * wanted entry stored or deflated. No zip64, encryption or multi-disk archives.
 */

import zlib from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** Central directory entries, or null when `bytes` isn't a zip this reads. */
export function zipEntries(bytes: Buffer): ZipEntry[] | null {
  // The end record sits in the last 22 bytes plus a comment of up to 64 KB.
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (bytes.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL) {
      return null;
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    entries.push({
      method: bytes.readUInt16LE(offset + 10),
      compressedSize: bytes.readUInt32LE(offset + 20),
      size: bytes.readUInt32LE(offset + 24),
      localOffset: bytes.readUInt32LE(offset + 42),
      name: bytes.toString("utf8", offset + 46, offset + 46 + nameLength),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** One entry's bytes; null when it's damaged, encrypted or bigger than `maxBytes`. */
export function readZipEntry(
  bytes: Buffer,
  entry: ZipEntry,
  maxBytes: number,
): Buffer | null {
  if (entry.size > maxBytes) {
    return null;
  }
  const at = entry.localOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== LOCAL) {
    return null;
  }
  const start =
    at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  try {
    if (entry.method === 0) {
      return Buffer.from(data);
    }
    if (entry.method === 8) {
      return zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
    }
  } catch {
    return null;
  }

  return null;
}

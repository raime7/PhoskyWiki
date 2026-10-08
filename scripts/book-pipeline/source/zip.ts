// 最小 ZIP 读取器（EPUB 用）：只支持存储与 deflate，校验 CRC-32；不支持 ZIP64 与加密。
// 不引入依赖：node:zlib 已足够，且 EPUB 一律是这两种压缩方式。

import { inflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 读出全部条目：路径 → 解压后的字节。目录条目跳过。 */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error("EPUB_ZIP: ZIP64 archives are not supported");
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("EPUB_ZIP: corrupt central directory");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString(flags & 0x800 ? "utf8" : "latin1", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`EPUB_ZIP: encrypted entry ${name}`);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`EPUB_ZIP: corrupt local header ${name}`);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`EPUB_ZIP: unsupported compression method ${method} for ${name}`);
    if (crc32(data) !== crc) throw new Error(`EPUB_ZIP: CRC mismatch for ${name}`);
    entries.set(name, data);
  }
  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("EPUB_ZIP: not a ZIP archive (end of central directory not found)");
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const watermarkPrefix = Buffer.from("LFN-Watermark\0", "ascii");

export type WatermarkImageMime = "image/png" | "image/jpeg" | "image/webp";

export class InvalidWatermarkImageError extends Error {}

export function detectWatermarkImageMime(bytes: Uint8Array): WatermarkImageMime | null {
  if (bytes.length >= 8 && pngSignature.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 &&
    bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 &&
    bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
  return null;
}

type Carrier = { start: number; end: number; value: string };
type Layout = { insertAt: number; carriers: Carrier[] };

function readCarrier(buffer: Buffer, start: number, end: number, dataStart: number, dataEnd: number): Carrier | null {
  if (dataEnd - dataStart < watermarkPrefix.length ||
    !buffer.subarray(dataStart, dataStart + watermarkPrefix.length).equals(watermarkPrefix)) return null;
  return { start, end, value: buffer.toString("latin1", dataStart + watermarkPrefix.length, dataEnd) };
}

function invalid(mime: string): never {
  throw new InvalidWatermarkImageError(`Invalid ${mime} image container`);
}

function pngLayout(buffer: Buffer): Layout {
  const carriers: Carrier[] = [];
  let insertAt = 0;
  let hasImage = false;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) break;
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) break;
      insertAt = end;
    }
    if (type === "IDAT") hasImage = true;
    if (type === "IEND" && length === 0 && hasImage) return { insertAt, carriers };
    if (type === "tEXt") {
      const carrier = readCarrier(buffer, offset, end, offset + 8, end - 4);
      if (carrier) carriers.push(carrier);
    }
    offset = end;
  }
  return invalid("PNG");
}

function webpLayout(buffer: Buffer): Layout {
  const riffEnd = buffer.readUInt32LE(4) + 8;
  if (riffEnd > buffer.length) return invalid("WebP");
  const carriers: Carrier[] = [];
  let hasImage = false;
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const type = buffer.toString("latin1", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataEnd = offset + 8 + length;
    const end = dataEnd + (length & 1);
    if (end > riffEnd) return invalid("WebP");
    if (type === "VP8 " || type === "VP8L" || type === "ANMF") hasImage = true;
    if (type === "LFNW") {
      const carrier = readCarrier(buffer, offset, end, offset + 8, dataEnd);
      if (carrier) carriers.push(carrier);
    }
    offset = end;
  }
  if (offset !== riffEnd || !hasImage) return invalid("WebP");
  return { insertAt: riffEnd, carriers };
}

function jpegLayout(buffer: Buffer): Layout {
  const carriers: Carrier[] = [];
  let insertAt = 2;
  let offset = 2;
  let inScan = false;
  let hasImage = false;
  while (offset < buffer.length) {
    if (inScan) offset = buffer.indexOf(0xff, offset);
    if (offset < 0 || buffer[offset] !== 0xff) break;
    while (buffer[offset] === 0xff) offset++;
    const start = offset - 1;
    const marker = buffer[offset++];
    if (inScan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    if (marker === 0xd9 && hasImage) return { insertAt, carriers };
    if (marker === 0x01) continue; // TEM is a standalone marker.
    if (marker < 0xc0 || marker === 0xd8 || marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > buffer.length) break;
    // Leave the initial JFIF/Exif markers in place. Place the watermark before
    // subsequent markers so their relative offsets (e.g. MPF) remain intact.
    if (start === insertAt && (marker === 0xe0 || marker === 0xe1)) insertAt = end;
    if (marker === 0xef) {
      const carrier = readCarrier(buffer, start, end, offset + 2, end);
      if (carrier) carriers.push(carrier);
    }
    if (marker === 0xda) hasImage = true;
    inScan = marker === 0xda || (inScan && marker === 0xdc); // DNL can interrupt an active scan.
    offset = end;
  }
  return invalid("JPEG");
}

function pngCarrier(data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write("tEXt", 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

function jpegCarrier(data: Buffer): Buffer {
  if (data.length > 0xffff - 2) throw new Error("LFN watermark exceeds JPEG APP15 size");
  const chunk = Buffer.alloc(data.length + 4);
  chunk.writeUInt16BE(0xffef);
  chunk.writeUInt16BE(data.length + 2, 2);
  data.copy(chunk, 4);
  return chunk;
}

function webpCarrier(data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.length + (data.length & 1));
  chunk.write("LFNW");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function encodeCarrier(mime: WatermarkImageMime, value: string): Buffer {
  const data = Buffer.concat([watermarkPrefix, Buffer.from(value, "ascii")]);
  return mime === "image/png" ? pngCarrier(data) : mime === "image/jpeg" ? jpegCarrier(data) : webpCarrier(data);
}

export function readWatermarkContainer(buffer: Buffer) {
  const mime = detectWatermarkImageMime(buffer);
  if (!mime) throw new InvalidWatermarkImageError("仅支持 PNG、JPEG 和 WebP 图片");
  const { insertAt, carriers } = mime === "image/png" ? pngLayout(buffer)
    : mime === "image/jpeg" ? jpegLayout(buffer) : webpLayout(buffer);
  let unsigned = buffer;
  let removedLength = 0;
  let insertionOffset = insertAt;
  if (carriers.length) {
    const parts: Buffer[] = [];
    let offset = 0;
    for (const carrier of carriers) {
      parts.push(buffer.subarray(offset, carrier.start));
      offset = carrier.end;
      const length = carrier.end - carrier.start;
      removedLength += length;
      if (carrier.start < insertAt) insertionOffset -= length;
    }
    parts.push(buffer.subarray(offset));
    unsigned = Buffer.concat(parts);
    if (mime === "image/webp") unsigned.writeUInt32LE(buffer.readUInt32LE(4) - removedLength, 4);
  }
  const carrier = carriers[0];
  return {
    mime,
    unsigned,
    watermark: carrier?.value,
    duplicate: carriers.length > 1,
    get canonicalCarrier() {
      return carriers.length === 1 && carrier.start === insertionOffset &&
        buffer.subarray(carrier.start, carrier.end).equals(encodeCarrier(mime, carrier.value));
    },
    embed(value: string): Buffer {
      const carrier = encodeCarrier(mime, value);
      const signed = Buffer.concat([unsigned.subarray(0, insertionOffset), carrier, unsigned.subarray(insertionOffset)]);
      if (mime === "image/webp") signed.writeUInt32LE(unsigned.readUInt32LE(4) + carrier.length, 4);
      return signed;
    },
  };
}

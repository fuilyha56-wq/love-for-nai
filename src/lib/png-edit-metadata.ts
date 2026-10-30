import { crc32 } from "node:zlib";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Re-encoding pixels must not discard NAI text parameters or retain an obsolete pixel signature. */
export function preserveEditedPngText(original: Buffer, output: Buffer): Buffer {
  if (!original.subarray(0, 8).equals(signature) || !output.subarray(0, 8).equals(signature)) return output;
  const text: Buffer[] = [];
  for (let offset = 8; offset + 12 <= original.length;) {
    const length = original.readUInt32BE(offset), end = offset + length + 12;
    if (end > original.length) break;
    const type = original.toString("ascii", offset + 4, offset + 8);
    if (["tEXt", "zTXt", "iTXt"].includes(type)) {
      const data = original.subarray(offset + 8, end - 4), separator = data.indexOf(0);
      if (separator > 0 && separator <= 79 && data.toString("latin1", 0, separator) !== "LFN-Watermark" && original.readUInt32BE(end - 4) === crc32(original.subarray(offset + 4, end - 4))) text.push(original.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") break;
  }
  if (!text.length) return output;
  // sharp produces a PNG without text chunks; insert unchanged ancillary blocks before IEND.
  for (let offset = 8; offset + 12 <= output.length;) {
    const end = offset + output.readUInt32BE(offset) + 12;
    if (end > output.length) break;
    if (output.toString("ascii", offset + 4, offset + 8) === "IEND") return Buffer.concat([output.subarray(0, offset), ...text, output.subarray(offset)]);
    offset = end;
  }
  return output;
}

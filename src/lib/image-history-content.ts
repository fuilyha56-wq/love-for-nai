/** Ignore only our signature chunk: the server adds it after streaming the image. */
export function imageHistoryContent(bytes: Uint8Array): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [bytes.subarray(0, 8)];
  let offset = 8;
  let removed = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) return bytes;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, end - 4);
    const zero = data.indexOf(0);
    const isWatermark = type === "tEXt" && zero === 13 &&
      String.fromCharCode(...data.subarray(0, zero)) === "LFN-Watermark";
    if (isWatermark) removed = true;
    else chunks.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  if (!removed) return bytes;
  chunks.push(bytes.subarray(offset));
  const content = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let position = 0;
  for (const chunk of chunks) {
    content.set(chunk, position);
    position += chunk.length;
  }
  return content;
}

export function sameImageHistoryContent(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

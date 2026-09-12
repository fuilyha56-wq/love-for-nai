const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_PREFIX_BYTES = 24; // 签名 8 + IHDR 长度 4 + 类型 4 + 宽 4 + 高 4
const BASE64_HEADER_CHARS = 32; // 24 字节 = 32 个 base64 字符

export type PngDimensions = { width: number; height: number };

export function stripDataUrl(value: string): string {
  const match = value.match(/^data:[^;,]+;base64,([\s\S]*)$/);
  return match ? (match[1] as string) : value;
}

// 仅读取 IHDR（前 24 字节），不解码整张图；超分计费与上限校验都以真实尺寸为准。
export function pngDimensions(base64: string): PngDimensions | null {
  const normalized = stripDataUrl(base64).replace(/\s/g, "");
  if (normalized.length < BASE64_HEADER_CHARS) return null;
  const header = Buffer.from(normalized.slice(0, BASE64_HEADER_CHARS), "base64");
  if (header.length < IHDR_PREFIX_BYTES) return null;
  if (!header.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * NAI 图片元数据解析（浏览器与 Node 通用，纯 Uint8Array 实现）。
 *
 * NovelAI 把生成参数 JSON 写在 PNG tEXt chunk（keyword="Comment"，
 * 另有 keyword="Software" 值为 "NovelAI"）；JPEG 则写入 COM 段。
 * 之前对整个文件 buffer 做正则截取，嵌套 JSON（如 v4_prompt）会被
 * 非贪婪匹配截断导致解析失败，这里改为按容器格式逐段提取。
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export type NaiImageMetadata = {
  /** 是否检测到 NovelAI 特征（Software/Source/参数结构）。 */
  isNai: boolean;
  /** 归一化后的生成参数（prompt/negative_prompt/width/height/steps 等）。 */
  parameters: Record<string, unknown>;
};

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index++)
    out += String.fromCharCode(bytes[index]);
  return out;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** 提取 PNG tEXt / 未压缩 iTXt chunk 的 keyword-value 对。 */
function pngTextChunks(bytes: Uint8Array): Array<[string, string]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Array<[string, string]> = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = latin1(bytes.subarray(offset + 4, offset + 8));
    if (type === "IEND") break;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "tEXt") {
      const zero = data.indexOf(0);
      if (zero > 0)
        chunks.push([
          latin1(data.subarray(0, zero)),
          latin1(data.subarray(zero + 1)),
        ]);
    } else if (type === "iTXt") {
      const zero = data.indexOf(0);
      const compressionFlag = zero > 0 ? data[zero + 1] : 1;
      if (zero > 0 && compressionFlag === 0) {
        const languageEnd = data.indexOf(0, zero + 3);
        const translatedEnd =
          languageEnd >= 0 ? data.indexOf(0, languageEnd + 1) : -1;
        if (translatedEnd >= 0)
          chunks.push([
            latin1(data.subarray(0, zero)),
            utf8(data.subarray(translatedEnd + 1)),
          ]);
      }
    }
    offset = dataEnd + 4;
  }
  return chunks;
}

/** 提取 JPEG COM 段文本。 */
function jpegComments(bytes: Uint8Array): Array<[string, string]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const comments: Array<[string, string]> = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break;
    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    if (marker === 0xfe)
      comments.push([
        "COM",
        latin1(bytes.subarray(offset + 4, offset + 2 + length)),
      ]);
    offset += 2 + length;
  }
  return comments;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // 不是完整 JSON，交给调用方 fallback。
  }
  return null;
}

/** 从首个 "{" 起做括号配对截取，容忍 JSON 前后的垃圾字节。 */
function parseBalancedJson(text: string): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return parseJsonObject(text.slice(0, index + 1));
    }
  }
  return null;
}

/** 在整段文本中定位含 "prompt" 的 JSON 对象（NAI Comment 的稳定特征）。 */
function extractEmbeddedJson(text: string): Record<string, unknown> | null {
  const marker = text.indexOf('"prompt"');
  if (marker < 0) return null;
  const start = text.lastIndexOf("{", marker);
  if (start < 0) return null;
  return parseBalancedJson(text.slice(start));
}

function looksLikeGenerationParameters(
  parsed: Record<string, unknown>,
): boolean {
  const hasPrompt =
    typeof parsed.prompt === "string" || typeof parsed.input === "string";
  const hasSize =
    typeof parsed.width === "number" || typeof parsed.height === "number";
  return hasPrompt || hasSize;
}

/** 合并嵌套 parameters，并把 uc/input 统一成 prompt/negative_prompt。 */
function normalizeParameters(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const nested =
    parsed.parameters &&
    typeof parsed.parameters === "object" &&
    !Array.isArray(parsed.parameters)
      ? (parsed.parameters as Record<string, unknown>)
      : {};
  const negative =
    parsed.uc ?? parsed.negative_prompt ?? parsed.negativePrompt ?? nested.uc;
  return {
    ...parsed,
    ...nested,
    prompt: parsed.prompt ?? parsed.input ?? nested.prompt ?? "",
    ...(negative != null ? { negative_prompt: negative } : {}),
  };
}

const NAI_SIGNATURE = /novelai|stable diffusion|v4_prompt/i;

/**
 * 解析图片中的 NAI 生成参数；不是 PNG/JPEG 或没有参数时返回 null。
 */
export function parseNaiImageMetadata(
  bytes: Uint8Array,
): NaiImageMetadata | null {
  if (!isPng(bytes) && !isJpeg(bytes)) return null;
  const chunks = new Map(
    isPng(bytes) ? pngTextChunks(bytes) : jpegComments(bytes),
  );
  const software = `${chunks.get("Software") || ""} ${chunks.get("Source") || ""}`;
  for (const key of ["Comment", "comment", "Description", "description", "COM"]) {
    const value = chunks.get(key);
    if (!value) continue;
    const parsed = parseJsonObject(value) || parseBalancedJson(value);
    if (!parsed || !looksLikeGenerationParameters(parsed)) continue;
    return {
      isNai:
        NAI_SIGNATURE.test(software) ||
        NAI_SIGNATURE.test(String(parsed.Software || "")) ||
        NAI_SIGNATURE.test(value),
      parameters: normalizeParameters(parsed),
    };
  }
  // fallback：chunk 结构异常（重新编码、被裁剪）时全文扫描。
  const text = latin1(bytes);
  if (!text.includes('"prompt"')) return null;
  const parsed = extractEmbeddedJson(text);
  if (!parsed || !looksLikeGenerationParameters(parsed)) return null;
  return { isNai: NAI_SIGNATURE.test(text), parameters: normalizeParameters(parsed) };
}

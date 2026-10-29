export type AssistantImageResource = { id: string; source: string; name: string; kind: "history" | "library"; description?: string };
export type AssistantImageSource = { source: string; name: string };
export const MAX_ASSISTANT_RESOURCE_BYTES = 20 * 1024 * 1024;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export function assistantDropFiles(files: Iterable<File>): File[] { return Array.from(files).filter((file) => imageTypes.has(file.type.toLowerCase()) || (!file.type && /\.(?:png|jpe?g|webp|gif)$/i.test(file.name))); }
export function hasAssistantImageDrag(transfer: Pick<DataTransfer, "files" | "items">): boolean {
  return assistantDropFiles(Array.from(transfer.files)).length > 0 || Array.from(transfer.items).some((item) => item.kind === "file" && imageTypes.has(item.type.toLowerCase()));
}
export function validateAssistantImageSource(source: string, origin: string): URL {
  if (!source || source.length > Math.ceil(MAX_ASSISTANT_RESOURCE_BYTES * 4 / 3) + 256) throw new Error("参考图来源过大或无效。");
  const url = new URL(source, origin);
  if (url.username || url.password) throw new Error("参考图网址不能包含登录凭据。");
  if (url.protocol === "data:") {
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(source)) throw new Error("请选择 PNG、JPEG、WebP 或 GIF 图片。");
  } else if (url.protocol === "blob:") {
    if (url.origin !== new URL(origin).origin) throw new Error("该临时图片属于其他页面来源。");
  } else if (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === new URL(origin).origin)) throw new Error("不支持此参考图网址。");
  return url;
}
function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const text = new TextDecoder("ascii").decode(bytes.subarray(0, 12));
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a")) return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}
export async function assistantImageFileWithType(file: File): Promise<File> {
  if (file.size > MAX_ASSISTANT_RESOURCE_BYTES) throw new Error("参考图不能超过 20 MB。");
  if (file.type.startsWith("image/")) return file;
  const type = imageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!type) throw new Error("请选择图片文件。");
  return new File([file], file.name, { type, lastModified: file.lastModified });
}
export async function assistantImageSourceFile(item: AssistantImageSource, signal: AbortSignal, origin = window.location.origin): Promise<File> {
  const url = validateAssistantImageSource(item.source, origin);
  const response = await fetch(url.href, { signal, credentials: url.origin === new URL(origin).origin ? "same-origin" : "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("参考图无法读取，请刷新图库后重试。");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_ASSISTANT_RESOURCE_BYTES) { await response.body?.cancel(); throw new Error("参考图不能超过 20 MB。"); }
  const reader = response.body?.getReader(); if (!reader) throw new Error("参考图没有可读取的内容。");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_ASSISTANT_RESOURCE_BYTES) { await reader.cancel(); throw new Error("参考图不能超过 20 MB。"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const type = imageMime(bytes); if (!type) throw new Error("此资源不是受支持的图片文件。");
  const name = (item.name || "参考图").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120).replace(/\.(?:png|jpe?g|webp|gif)$/i, "");
  return new File([bytes], `${name || "参考图"}.${type === "image/jpeg" ? "jpg" : type.slice(6)}`, { type });
}

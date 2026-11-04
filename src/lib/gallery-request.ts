export const MAX_GALLERY_REQUEST_BYTES = 42 * 1024 * 1024;
export class GalleryRequestTooLargeError extends Error {
  constructor() { super("投稿请求体过大，参赛图和校验原图各不能超过 20 MB"); }
}

export async function readGalleryBody(request: Request, limit = MAX_GALLERY_REQUEST_BYTES): Promise<ArrayBuffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new GalleryRequestTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new GalleryRequestTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body.buffer;
}

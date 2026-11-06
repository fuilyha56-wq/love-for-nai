import "server-only";

export async function readWatermarkUpload(request: Request, maxBytes: number): Promise<Buffer | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts, size);
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

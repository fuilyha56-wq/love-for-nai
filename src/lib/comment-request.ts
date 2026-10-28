export async function readCommentBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 32 * 1024;
  if (Number(request.headers.get("content-length")) > limit || !request.body) throw new Error("评论请求过大或为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error("评论请求过大"); }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(merged));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("评论请求格式无效");
  return body;
}

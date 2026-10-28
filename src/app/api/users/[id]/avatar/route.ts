import { readAvatar } from "@/lib/avatars";

const fallback = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#eeeae5"/><circle cx="64" cy="46" r="20" fill="#a83a4c"/><path d="M26 112a38 38 0 0 1 76 0" fill="#a83a4c"/></svg>';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = (await context.params).id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) return new Response(null, { status: 404 });
  try {
    const avatar = await readAvatar(id);
    const etag = `"${avatar?.hash || "default-v1"}"`;
    const headers = { "Content-Type": avatar ? "image/webp" : "image/svg+xml", "Cache-Control": "public, max-age=0, must-revalidate", ETag: etag, "X-Content-Type-Options": "nosniff" };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(avatar ? new Uint8Array(avatar.data) : fallback, { headers });
  } catch { return new Response(fallback, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } }); }
}

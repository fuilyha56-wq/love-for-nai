import { POST as generateImage } from "@/app/ai/generate-image/route";
import { parseNaiGenerationBody } from "@/lib/compat-api";

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await parseNaiGenerationBody(request);
  } catch {
    return Response.json({ message: "Request body must be valid JSON" }, { status: 400 });
  }
  const parameters =
    body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
      ? { ...(body.parameters as Record<string, unknown>), stream: "msgpack" }
      : { stream: "msgpack" };
  // 转发体已还原为纯 JSON，去掉原 multipart 的 content-type/length。
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  const forwarded = new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, parameters }),
  });
  return generateImage(forwarded);
}

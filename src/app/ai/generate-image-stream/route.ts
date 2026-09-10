import { POST as generateImage } from "@/app/ai/generate-image/route";

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ message: "Request body must be valid JSON" }, { status: 400 });
  }
  const parameters =
    body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
      ? { ...(body.parameters as Record<string, unknown>), stream: "msgpack" }
      : { stream: "msgpack" };
  const forwarded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...body, parameters }),
  });
  return generateImage(forwarded);
}

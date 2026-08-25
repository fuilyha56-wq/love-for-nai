import {
  bearerAuthorization,
  naiZipResponse,
  proxyNewApi,
} from "@/lib/compat-api";

const operations: Record<string, string> = {
  declutter: "director-declutter",
  "bg-removal": "director-bg-remover",
  lineart: "director-lineart",
  sketch: "director-sketch",
  colorize: "director-colorize",
  emotion: "director-emotion",
};

export async function POST(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;

  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Invalid request body" },
      { status: 400 },
    );
  }
  const operation = typeof body.req_type === "string" ? operations[body.req_type] : undefined;
  if (!operation)
    return Response.json({ message: "Unsupported req_type" }, { status: 400 });
  if (typeof body.image !== "string" || !body.image)
    return Response.json({ message: "image is required" }, { status: 400 });

  const upstream = await proxyNewApi(
    new Request(request.url, {
      method: "POST",
      headers: { Authorization: authorization },
    }),
    "/v1/images/generations",
    JSON.stringify({
      ...body,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      model: "nai-v4.5-full",
      novelai_operation: operation,
      response_format: "b64_json",
    }),
    "application/json",
  );
  return naiZipResponse(upstream);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json"))
    return (await request.json()) as Record<string, unknown>;

  const form = await request.formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      body[key] = Buffer.from(await value.arrayBuffer()).toString("base64");
    } else if (["width", "height", "defry"].includes(key)) {
      body[key] = Number(value);
    } else {
      body[key] = value;
    }
  }
  return body;
}
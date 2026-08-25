import { NextResponse } from "next/server";

export class InvalidJsonError extends Error {}

// 直接 await request.json() 会在畸形 JSON 上抛出未捕获异常，返回空白 500。
export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new InvalidJsonError("请求体必须是 JSON 对象");
    return body as T;
  } catch (error) {
    if (error instanceof InvalidJsonError) throw error;
    throw new InvalidJsonError("请求体不是合法的 JSON");
  }
}

export function invalidJsonResponse(error: unknown): NextResponse {
  return NextResponse.json(
    {
      message:
        error instanceof InvalidJsonError ? error.message : "请求体解析失败",
    },
    { status: 400 },
  );
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

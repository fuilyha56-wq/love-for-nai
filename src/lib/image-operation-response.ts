export type ImageOperationResult = {
  message?: string;
  images?: string[];
  image?: string;
  payment?: string;
  historyIds?: unknown;
  partial?: boolean;
  tags?: unknown;
};

function invalidResponseMessage(status: number): string {
  return `生图接口返回 HTTP ${status}，未收到有效结果。请先核对图片历史和余额，避免重复扣费。`;
}

export async function readImageOperationResponse(
  response: Response,
): Promise<ImageOperationResult> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("json")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(invalidResponseMessage(response.status));
  }
  try {
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("Invalid image response");
    return result as ImageOperationResult;
  } catch {
    throw new Error(invalidResponseMessage(response.status));
  }
}

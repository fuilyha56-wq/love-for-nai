import { NextResponse } from "next/server";
import { parseJsonBody, invalidJsonResponse } from "@/lib/request";
import { verifyWatermark } from "@/lib/image-watermark";
import { findHistory, findHistoryByRequestId } from "@/lib/history";
import { findRequestAudit } from "@/lib/request-audit";

export async function POST(request: Request) {
  let body: { image?: unknown };
  try {
    body = await parseJsonBody<{ image?: unknown }>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }

  const image = body.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ message: "无效的图片数据" }, { status: 400 });
  }

  try {
    const result = await verifyWatermark(image);
    if (!result.valid || !result.payload) return NextResponse.json(result);
    const audit = await findRequestAudit(result.payload.requestId);
    const history = result.payload.userId
      ? (result.payload.imageId
        ? await findHistory(result.payload.userId, result.payload.imageId)
        : await findHistoryByRequestId(result.payload.userId, result.payload.requestId))
      : null;
    const publicPayload = { ...result.payload };
    delete publicPayload.parameters;
    return NextResponse.json({
      ...result,
      payload: publicPayload,
      recordFound: Boolean(audit || history),
      audit: audit ? {
        requestId: audit.requestId,
        requestFingerprint: audit.requestFingerprint,
        createdAt: audit.createdAt,
        endpoint: audit.endpoint,
        operation: audit.operation,
        model: audit.model,
        status: audit.status,
        durationMs: audit.durationMs,
        historyIds: audit.historyIds,
        paymentSource: audit.paymentSource,
      } : null,
      history: history ? {
        id: history.id,
        createdAt: history.createdAt,
        usage: history.usage,
        fingerprint: history.fingerprint,
        requestId: history.requestId,
        requestFingerprint: history.requestFingerprint,
        watermarkStatus: history.watermarkStatus,
      } : null,
    });
  } catch (error) {
    return NextResponse.json(
      { valid: false, error: error instanceof Error ? error.message : "验证失败" },
      { status: 500 }
    );
  }
}

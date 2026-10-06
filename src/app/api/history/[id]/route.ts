import { NextResponse } from "next/server";
import { parseImageHistoryMetadata } from "@/lib/editor-composite-history";
import { findHistory } from "@/lib/history";
import { getSession } from "@/lib/session";

const headers = { "Cache-Control": "private, no-store" };

function storedParameters(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = { ...parseImageHistoryMetadata(input) };
  for (const key of ["operation", "model", "prompt", "negative_prompt", "sampler", "noise_schedule", "emotion", "upscale_model"]) {
    if (typeof input[key] === "string") output[key] = input[key];
  }
  for (const key of ["width", "height", "steps", "scale", "n", "n_samples", "cfg_rescale", "seed", "strength", "noise", "ucPreset"]) {
    if (typeof input[key] === "number" && Number.isFinite(input[key])) output[key] = input[key];
  }
  if (typeof input.qualityToggle === "boolean") output.qualityToggle = input.qualityToggle;
  return output;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后读取历史参数" }, { status: 401, headers });
  const item = await findHistory(session.userId, (await params).id);
  if (!item) return NextResponse.json({ message: "历史记录不存在" }, { status: 404, headers });
  return NextResponse.json({
    id: item.id,
    createdAt: item.createdAt,
    imageUrl: `/api/history/${item.id}/image`,
    parameters: storedParameters(item.parameters),
  }, { headers });
}

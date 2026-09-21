import { NextResponse } from "next/server";
import { saveHistory } from "@/lib/history";
import { assertBodySize } from "@/lib/image-request";
import { pngDimensions } from "@/lib/png-dims";
import { getSession } from "@/lib/session";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

const PNG_DATA_URL = /^data:image\/png;base64,[a-zA-Z0-9+/=\s]+$/;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录后保存编辑结果" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    assertBodySize(request);
    body = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }

  const image = typeof body.image === "string" ? body.image : "";
  if (!PNG_DATA_URL.test(image))
    return NextResponse.json({ message: "编辑结果必须是 PNG 图片" }, { status: 400 });
  const dimensions = pngDimensions(image);
  if (!dimensions || dimensions.width * dimensions.height > 16_000_000)
    return NextResponse.json({ message: "编辑结果尺寸无效或过大" }, { status: 400 });

  const items = await saveHistory(
    session.userId,
    {
      operation: "editor-composite",
      model: typeof body.model === "string" ? body.model : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 10_000) : undefined,
      negative_prompt:
        typeof body.negative_prompt === "string"
          ? body.negative_prompt.slice(0, 10_000)
          : undefined,
      width: dimensions.width,
      height: dimensions.height,
      steps: typeof body.steps === "number" ? body.steps : undefined,
      scale: typeof body.scale === "number" ? body.scale : undefined,
      sampler: typeof body.sampler === "string" ? body.sampler : undefined,
      seed: typeof body.seed === "number" ? body.seed : undefined,
      strength: typeof body.strength === "number" ? body.strength : undefined,
    },
    [image],
    null,
  );
  const item = items[0];
  if (!item)
    return NextResponse.json({ message: "编辑结果保存失败" }, { status: 500 });
  return NextResponse.json({ id: item.id, imageUrl: `/api/history/${item.id}/image` });
}

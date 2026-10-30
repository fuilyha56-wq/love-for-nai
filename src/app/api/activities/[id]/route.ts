import { publicActivityDetail } from "@/lib/activity-leaderboards";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const page = Math.max(
    1,
    Math.floor(Number(new URL(request.url).searchParams.get("page")) || 1),
  );
  const detail = await publicActivityDetail((await params).id, page);
  return Response.json(detail || { message: "活动不存在" }, {
    status: detail ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}

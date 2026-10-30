import { publicActivityList } from "@/lib/activity-leaderboards";
export async function GET(request: Request) {
  const page = Math.max(
    1,
    Math.floor(Number(new URL(request.url).searchParams.get("page")) || 1),
  );
  return Response.json(await publicActivityList(page), {
    headers: { "Cache-Control": "no-store" },
  });
}

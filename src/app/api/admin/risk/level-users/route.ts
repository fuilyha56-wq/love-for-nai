import { requireAdmin } from "@/lib/admin-auth";
import { listRiskCases } from "@/lib/risk-control";
import { requestUsageByUser } from "@/lib/request-audit";
import { getRiskSettings } from "@/lib/risk-settings";
import { userDisplayNames } from "@/lib/user-display";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return Response.json({ message: gate.error }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const settings = await getRiskSettings();
  const level = params.get("level") || "normal";
  if (!settings.levels.some((l) => l.id === level))
    return Response.json({ message: "风险等级无效" }, { status: 400 });
  const requested = Number(params.get("page") || 1);
  const page =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, 1000)
      : 1;
  const keyword = (params.get("keyword") || "")
    .trim()
    .toLowerCase()
    .slice(0, 100);
  const [cases, usage] = await Promise.all([
    listRiskCases(5000),
    requestUsageByUser(),
  ]);
  const active = new Map(
    cases
      .filter((c) => c.status !== "closed" || c.enforcement?.blocked)
      .map((c) => [c.userId, c]),
  );
  const ids = [...new Set([...active.keys(), ...usage.keys()])];
  const names = await userDisplayNames(ids);
  const items = ids
    .flatMap((userId) => {
      const record = active.get(userId);
      if (record?.enforcement?.blocked) return [];
      const score = record?.score || 0;
      const grade = [...settings.levels]
        .reverse()
        .find((l) => score >= l.minimum)!;
      const username =
        names.get(userId)?.name || record?.username || `账号 ${userId}`;
      return grade.id === level &&
        `${userId} ${username}`.toLowerCase().includes(keyword)
        ? [{ userId, username, score: Number(score.toFixed(1)) }]
        : [];
    })
    .sort((a, b) => b.score - a.score || a.userId - b.userId);
  return Response.json(
    {
      items: items.slice((page - 1) * 10, page * 10),
      total: items.length,
      page,
      policyVersion: settings.version,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

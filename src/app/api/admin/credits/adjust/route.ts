import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adjustAff, adjustPackageBalance, affLedger } from "@/lib/aff";
import {
  invalidJsonResponse,
  optionalNumber,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const userId = optionalNumber(raw.userId);
  if (!userId || !Number.isInteger(userId) || userId <= 0)
    return NextResponse.json({ message: "缺少用户 id" }, { status: 400 });
  const personalDelta = optionalNumber(raw.personalDelta) ?? 0;
  const packageDelta = optionalNumber(raw.packageDelta) ?? 0;
  if (!Number.isInteger(personalDelta) || !Number.isInteger(packageDelta))
    return NextResponse.json({ message: "调整金额必须是整数" }, { status: 400 });
  if (personalDelta === 0 && packageDelta === 0)
    return NextResponse.json({ message: "请填写要发放或回收的额度" }, { status: 400 });
  const note = optionalString(raw.description)?.trim().slice(0, 120);
  const actor = gate.session.displayName || gate.session.username;
  try {
    if (personalDelta !== 0)
      await adjustAff(userId, personalDelta, note || `管理员调整创作额度（${actor}）`);
    if (packageDelta !== 0)
      await adjustPackageBalance(userId, packageDelta, note || `管理员调整图包额度（${actor}）`);
    return NextResponse.json({ item: await affLedger(userId) });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "额度调整失败" },
      { status: 400 },
    );
  }
}

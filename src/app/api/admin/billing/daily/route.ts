import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody } from "@/lib/request";
import { dailyImageBillingState, saveDailyImagePolicy } from "@/lib/daily-image-billing";
import type { DailyImagePolicy } from "@/lib/daily-image-pricing";
export async function GET() { const gate = await requireAdmin(); if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 }); return NextResponse.json(await dailyImageBillingState(gate.session.userId), { headers: { "Cache-Control": "private, no-store" } }); }
export async function PUT(request: Request) { const gate = await requireAdmin(); if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 }); try { await saveDailyImagePolicy(await parseJsonBody<DailyImagePolicy>(request)); return NextResponse.json(await dailyImageBillingState(gate.session.userId)); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "保存每日阶梯失败" }, { status: 400 }); } }

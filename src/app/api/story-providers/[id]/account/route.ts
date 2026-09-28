import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { findStoryProvider } from "@/lib/story-providers";
import { fetchWithModelConcurrency } from "@/lib/model-concurrency";

type AccountData = {
  tier?: number;
  active?: boolean;
  expiresAt?: number;
  trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number };
  perks?: { contextTokens?: number };
  priority?: { taskPriority?: number; nextRefillAt?: number };
  information?: { banStatus?: string };
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const provider = await findStoryProvider(session.userId, (await params).id);
  if (!provider || provider.kind !== "novelai") return NextResponse.json({ message: "NovelAI Key 不存在" }, { status: 404 });
  try {
    const read = async (path: string) => {
      const response = await fetchWithModelConcurrency(`https://image.novelai.net${path}`, {
        headers: { Authorization: `Bearer ${provider.secret}`, Accept: "application/json" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`NovelAI 账号信息读取失败 (${response.status})`);
      return await response.json() as AccountData;
    };
    const [subscription, user] = await Promise.all([read("/user/subscription"), read("/user/data")]);
    return NextResponse.json({
      tier: subscription.tier,
      active: subscription.active,
      expiresAt: subscription.expiresAt,
      anlas: (subscription.trainingStepsLeft?.fixedTrainingStepsLeft || 0) + (subscription.trainingStepsLeft?.purchasedTrainingSteps || 0),
      contextTokens: subscription.perks?.contextTokens,
      priority: user.priority?.taskPriority,
      nextRefillAt: user.priority?.nextRefillAt,
      banStatus: user.information?.banStatus,
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "账号读取失败" }, { status: 502 });
  }
}
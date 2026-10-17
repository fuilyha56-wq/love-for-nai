import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readRiskJson, validRiskMutation } from "@/lib/risk-http";
import type { RiskSettings } from "@/lib/risk-settings";
import { requireAdmin } from "@/lib/admin-auth";
import { RISK_FIELDS, defaultRiskSettings, getRiskSettings, publishRiskSettings, validateRiskSettings, writeRiskJson } from "@/lib/risk-settings";
import { getRuntimeSettings } from "@/lib/runtime-config";

const directory = () => path.resolve(process.env.LFN_DATA_DIR || "data", "risk");
export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return Response.json({ message: gate.error }, { status: 403 });
  let history: string[] = [], draft: unknown = null;
  try { history = (await readdir(path.join(directory(), "policy-history"))).filter(f => /^risk-[\da-f-]+\.json$/.test(f)).sort().reverse().slice(0, 30); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  try { draft = JSON.parse(await readFile(path.join(directory(), "settings-draft.json"), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  return Response.json({ settings: await getRiskSettings(), defaults: defaultRiskSettings(), fields: RISK_FIELDS, history, draft, readiness: { processMode: "single-process", sharedAtomic: false, content: "明确受信上游结果；未知不算通过", deviceSecret: Boolean(process.env.LFN_RISK_HASH_SECRET?.trim() || process.env.LFN_SESSION_SECRET?.trim()), trustedIp: (await getRuntimeSettings()).trustProxy, semantic: false, externalReputation: false, captcha: false } }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return Response.json({ message: gate.error }, { status: 403 });
  if (!validRiskMutation(request)) return Response.json({ message: "请求来源或格式无效" }, { status: 403 });
  try {
    const body = await readRiskJson(request);
    let candidate = body.settings;
    if (body.action === "rollback") {
      if (typeof body.history !== "string" || !/^risk-[\da-f-]+\.json$/.test(body.history)) throw new Error("历史版本无效");
      candidate = JSON.parse(await readFile(path.join(directory(), "policy-history", body.history), "utf8")).before;
    }
    if (body.action === "defaults") candidate = defaultRiskSettings();
    const validated = validateRiskSettings(candidate as RiskSettings);
    if (body.action === "draft") {
      const draft = { settings: validated, reason: String(body.reason || "").slice(0, 500), savedAt: new Date().toISOString(), operator: gate.session.userId };
      await writeRiskJson(path.join(directory(), "settings-draft.json"), draft);
      return Response.json({ message: "草稿已保存，尚未生效", draft });
    }
    if (body.action === "validate") return Response.json({ valid: true });
    if (!["publish", "rollback", "defaults"].includes(String(body.action))) throw new Error("未知操作");
    const settings = await publishRiskSettings(validated, String(body.expectedVersion || ""), String(gate.session.userId), String(body.reason || ""));
    return Response.json({ settings });
  } catch (e) { const message = e instanceof Error ? e.message : "策略保存失败"; return Response.json({ message }, { status: message.includes("策略已更新") ? 409 : 400 }); }
}

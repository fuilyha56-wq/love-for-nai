"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import RiskAccessForm from "./risk-access-form";

type GrantInfo = {
  day: string;
  exits: number;
  rebinds: number;
};

type SecurityInfo = {
  enabled: boolean;
  grade: string;
  grant: GrantInfo | null;
  rebindPolicy: { mode: "count" | "cooldown" | "hybrid"; maxRebinds: number; minRebindSeconds: number };
  restrictions: Array<{ id: string; reason: string; expiresAt: number }>;
};

function cooldownLabel(seconds: number) {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function rebindPolicyLabel(policy: SecurityInfo["rebindPolicy"]) {
  if (policy.mode === "count") return `固定次数：每天最多换绑 ${policy.maxRebinds} 次。`;
  if (policy.mode === "cooldown") return `按冷却时间：每次换绑后需间隔 ${cooldownLabel(policy.minRebindSeconds)}。`;
  return `混合模式：每天最多换绑 ${policy.maxRebinds} 次，每次间隔 ${cooldownLabel(policy.minRebindSeconds)}。`;
}

export default function RiskSecurity({ onEnabledChange }: { onEnabledChange: (enabled: boolean) => void }) {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadInfo = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/security/grant", {
        cache: "no-store",
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "读取今日免费授权失败");
      if (signal?.aborted) return;
      const enabled = result?.enabled === true;
      onEnabledChange(enabled);
      if (!enabled) {
        setInfo(null);
        setLoadState("loaded");
        return;
      }
      setInfo(result as SecurityInfo);
      setLoadState("loaded");
    } catch (error) {
      if (signal?.aborted) return;
      onEnabledChange(false);
      setInfo(null);
      setLoadError(error instanceof Error ? error.message : "读取今日免费授权失败");
      setLoadState("error");
    }
  }, [onEnabledChange]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadInfo(controller.signal));
    return () => controller.abort();
  }, [loadInfo]);

  async function rebind() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/security/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "换绑失败");
      setMessage("已绑定当前网络；旧出口授权已失效，额度和计费累计保持不变。");
      await loadInfo();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请求失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    {info?.enabled && (
    <section id="account-security" className="profile-network-grant-card rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold"><ShieldCheck size={17} />免费额度与账号安全</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {info?.grant
          ? `${info.grant.day} 已有免费网络授权，今日已换绑 ${info.grant.rebinds} 次。`
          : "当天首次使用个人奖励 AFF 时自动建立网络授权。购买图包按独立规则使用。"}
      </p>
      {info?.rebindPolicy && (
        <div className="profile-network-grant-policy" role="note">
          <strong>当前换绑规则：</strong>{rebindPolicyLabel(info.rebindPolicy)}
          <br />10 分钟内连续触发 3 次换绑限制，将触发 2 小时账号限流。
        </div>
      )}
      {info?.restrictions.map((restriction) => (
        <p key={restriction.id} className="mt-2 text-sm">
          {restriction.reason} · 到期 {new Date(restriction.expiresAt).toLocaleString()}
        </p>
      ))}
      <p className="mt-2 text-xs text-[var(--muted)]">
        换网后可在重新登录后确认，换绑受次数和冷却限制。帮助和账号读取不受生成冷却影响。
      </p>

      {loadState === "loading" && (
        <p className="mt-3 text-sm text-[var(--muted)]" role="status">
          正在读取今日免费授权…
        </p>
      )}
      {loadState === "error" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <p role="alert">无法读取今日授权：{loadError}</p>
          <button
            type="button"
            onClick={() => void loadInfo()}
            className="rounded border border-[var(--line)] px-3 py-2"
          >
            重新读取
          </button>
        </div>
      )}
      {loadState === "loaded" && !info?.grant && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          今日尚未建立免费网络授权，无需换绑；首次使用个人奖励 AFF 时会自动绑定。
        </p>
      )}
      <button
        type="button"
        disabled={busy || loadState !== "loaded" || !info?.grant}
        onClick={() => void rebind()}
        className="mt-3 rounded border border-[var(--line)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "正在确认…" : "确认将免费授权换绑到当前网络"}
      </button>
      {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    </section>
    )}
    <RiskAccessForm />
    </>
  );
}

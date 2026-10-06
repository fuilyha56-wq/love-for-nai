"use client";

import { Pencil, Plus, Power, PowerOff, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PopupSelect } from "@/app/ui/popup-select";

type EndpointConfig = {
  id: string;
  type: "auth" | "image" | "wallet";
  adapterType: string;
  name: string;
  enabled: boolean;
  config: { baseUrl?: string; token?: string };
  priority: number;
  createdAt: string;
  updatedAt: string;
};

type RuntimeSettings = {
  authProvider: "newapi" | "local";
  newApiBaseUrl: string;
  newApiAdminToken: string;
  newApiAdminUserId: string;
  registerGroup: string;
  quotaPerUnit: number;
  imagePackageAffPerPackage: number;
  imagePackageRateLimit: number;
  imagePackagePriceUsd: number;
  affGatewayUrl: string;
  affGatewayToken: string;
  naiApiUrl: string;
  naiApiToken: string;
  naiImageApiUrl: string;
  naiImageApiToken: string;
  imageProviderUrl: string;
  imageProviderToken: string;
  publicUrl: string;
  sourceCodeUrl: string;
  outboundProxy: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  remoteHistoryUrl: string;
  remoteHistoryToken: string;
  enableV5Models: boolean;
  enableV45Models: boolean;
  enableDailyCheckIn: boolean;
  enableReferral: boolean;
  dailyCheckInReward: number;
  referralReward: number;
  watermarkEnabled: boolean;
  watermarkIssuer: string;
  watermarkLabel: string;
  watermarkNote: string;
};

type EndpointForm = {
  id?: string;
  type: "auth" | "image" | "wallet";
  adapterType: string;
  name: string;
  baseUrl: string;
  token: string;
  priority: string;
  enabled: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  auth: "认证系统",
  image: "图像生成",
  wallet: "钱包计费",
};

const ADAPTER_TYPES: Record<string, Array<{ value: string; label: string; description: string }>> = {
  auth: [
    { value: "newapi", label: "NewAPI", description: "沿用现有账号、分组和余额" },
    { value: "local", label: "本地账号", description: "LFN 自管用户，不依赖 NewAPI" },
  ],
  image: [
    { value: "gateway", label: "NovelAI Gateway", description: "额度足够时直连 Gateway 出图" },
    { value: "openai_compat", label: "OpenAI 兼容接口", description: "任意 /v1/images/generations 服务" },
  ],
  wallet: [{ value: "newapi", label: "NewAPI 余额", description: "上游 quota，配合 AFF / 图包" }],
};

const EMPTY_SETTINGS: RuntimeSettings = {
  authProvider: "newapi",
  newApiBaseUrl: "",
  newApiAdminToken: "",
  newApiAdminUserId: "1",
  registerGroup: "ikun",
  quotaPerUnit: 500000,
  imagePackageAffPerPackage: 400,
  imagePackageRateLimit: 10,
  imagePackagePriceUsd: 200,
  affGatewayUrl: "",
  affGatewayToken: "",
  naiApiUrl: "",
  naiApiToken: "",
  naiImageApiUrl: "",
  naiImageApiToken: "",
  imageProviderUrl: "",
  imageProviderToken: "",
  publicUrl: "",
  sourceCodeUrl: "",
  outboundProxy: "",
  trustProxy: false,
  cookieSecure: false,
  remoteHistoryUrl: "",
  remoteHistoryToken: "",
  enableV5Models: true,
  enableV45Models: true,
  enableDailyCheckIn: true,
  enableReferral: true,
  dailyCheckInReward: 20,
  referralReward: 100,
  watermarkEnabled: true,
  watermarkIssuer: "love-for-nai",
  watermarkLabel: "Love-for-NAI image provenance",
  watermarkNote: "Generated through Love-for-NAI",
};

function emptyForm(type: EndpointForm["type"] = "image"): EndpointForm {
  return {
    type,
    adapterType: ADAPTER_TYPES[type][0].value,
    name: "",
    baseUrl: "",
    token: "",
    priority: "50",
    enabled: true,
  };
}

export default function PlatformConfigPanel({ setMessage }: { setMessage: (msg: string) => void }) {
  const [settings, setSettings] = useState<RuntimeSettings>(EMPTY_SETTINGS);
  const [endpoints, setEndpoints] = useState<EndpointConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EndpointForm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResponse, endpointsResponse] = await Promise.all([
        fetch("/api/admin/platform/settings", { cache: "no-store" }),
        fetch("/api/admin/platform/endpoints", { cache: "no-store" }),
      ]);
      const settingsResult = await settingsResponse.json();
      const endpointsResult = await endpointsResponse.json();
      if (!settingsResponse.ok) {
        setMessage(settingsResult.message || "站点设置读取失败");
        return;
      }
      if (!endpointsResponse.ok) {
        setMessage(endpointsResult.message || "端点读取失败");
        return;
      }
      setSettings({ ...EMPTY_SETTINGS, ...settingsResult.settings });
      setEndpoints(endpointsResult.endpoints || []);
    } catch {
      setMessage("平台配置读取失败");
    } finally {
      setLoading(false);
    }
  }, [setMessage]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function saveSettings() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/platform/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "保存失败");
        return;
      }
      setSettings({ ...EMPTY_SETTINGS, ...result.settings });
      setMessage("站点设置已保存，立即生效");
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveEndpoint() {
    if (!editing) return;
    const priority = Number(editing.priority);
    if (!Number.isInteger(priority)) {
      setMessage("优先级必须是整数");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/platform/endpoints", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          type: editing.type,
          adapterType: editing.adapterType,
          name: editing.name,
          enabled: editing.enabled,
          priority,
          config: { baseUrl: editing.baseUrl, token: editing.token },
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "端点保存失败");
        return;
      }
      setMessage(editing.id ? "端点已更新" : "端点已添加");
      setEditing(null);
      await load();
    } catch {
      setMessage("端点保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEndpoint(item: EndpointConfig) {
    const response = await fetch("/api/admin/platform/endpoints", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.message || "切换失败");
      return;
    }
    setMessage(item.enabled ? `已停用 ${item.name}` : `已启用 ${item.name}`);
    await load();
  }

  async function removeEndpoint(item: EndpointConfig) {
    if (!window.confirm(`确定删除端点「${item.name}」？`)) return;
    const response = await fetch(`/api/admin/platform/endpoints?id=${encodeURIComponent(item.id)}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.message || "删除失败");
      return;
    }
    setMessage("端点已删除");
    await load();
  }

  const grouped = endpoints.reduce<Record<string, EndpointConfig[]>>((acc, item) => {
    (acc[item.type] ||= []).push(item);
    return acc;
  }, {});

  if (loading) return <p className="text-sm text-[var(--muted)]">加载中…</p>;

  return (
    <div className="space-y-5">
      <article className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">站点设置</p>
            <p className="mt-1 text-sm text-[var(--muted)]">账号、上游、余额单位、Cookie 和远程历史都可在这里改。真正出图走下方启用的图像端点，Gateway 只是可选项，不是必选项。密钥留脱敏值表示保持不变。</p>
          </div>
          <button type="button" disabled={saving} onClick={saveSettings} className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
            <Save size={15} />{saving ? "保存中…" : "保存设置"}
          </button>
        </div>
        <details open className="config-group">
          <summary className="config-group-summary">账号与基础站点</summary>
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">账号提供者
            <div className="mt-1.5">
              <PopupSelect
                value={settings.authProvider}
                onChange={(value) => setSettings({ ...settings, authProvider: value as "newapi" | "local" })}
                ariaLabel="账号提供者"
                options={[
                  { value: "newapi", label: "NewAPI 账号", description: "登录、分组、密钥走上游" },
                  { value: "local", label: "本地账号", description: "LFN 自管用户和创作额度" },
                ]}
              />
            </div>
          </label>
          <label className="block text-sm font-semibold">注册默认分组
            <input value="default" readOnly aria-readonly="true" className="field mt-1.5 h-10 w-full cursor-not-allowed px-3 text-sm opacity-70" />
            <span className="mt-1 block text-[10px] font-normal text-[var(--muted)]">新用户保持 NewAPI default 分组；生图由 LFN 托管密钥（Draw 等可用分组）计费，不可修改。</span>
          </label>
          <label className="block text-sm font-semibold">NewAPI 地址
            <input value={settings.newApiBaseUrl} onChange={(event) => setSettings({ ...settings, newApiBaseUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="http://host.docker.internal:3000" />
          </label>
          <label className="block text-sm font-semibold">NewAPI 管理员用户 ID
            <input value={settings.newApiAdminUserId} onChange={(event) => setSettings({ ...settings, newApiAdminUserId: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold sm:col-span-2">NewAPI 管理员令牌
            <input value={settings.newApiAdminToken} onChange={(event) => setSettings({ ...settings, newApiAdminToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="留脱敏值表示不改" />
          </label>
          <label className="block text-sm font-semibold">余额单位（quota / $1）
            <input value={String(settings.quotaPerUnit)} onChange={(event) => setSettings({ ...settings, quotaPerUnit: Number(event.target.value) || 0 })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold">每包图包额度（AFF）
            <input type="number" min={1} step="any" value={settings.imagePackageAffPerPackage} onChange={(event) => setSettings({ ...settings, imagePackageAffPerPackage: Number(event.target.value) || 0 })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
            <span className="mt-1 block text-[10px] font-normal text-[var(--muted)]">购买一包后增加的图包额度。</span>
          </label>
          <label className="block text-sm font-semibold">图包每分钟消耗限制（张）
            <input type="number" min={1} step={1} value={settings.imagePackageRateLimit} onChange={(event) => setSettings({ ...settings, imagePackageRateLimit: Number(event.target.value) || 0 })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
            <span className="mt-1 block text-[10px] font-normal text-[var(--muted)]">每个用户每 60 秒最多使用的图包张数。</span>
          </label>
          <label className="block text-sm font-semibold">购买一包图包价格（美元）
            <input type="number" min={0.01} step="0.01" value={settings.imagePackagePriceUsd} onChange={(event) => setSettings({ ...settings, imagePackagePriceUsd: Number(event.target.value) || 0 })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
            <span className="mt-1 block text-[10px] font-normal text-[var(--muted)]">购买时从 NewAPI 余额扣除的美元金额。</span>
          </label>
          <label className="block text-sm font-semibold">公开地址
            <input value={settings.publicUrl} onChange={(event) => setSettings({ ...settings, publicUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          </div>
        </details>
        <details open className="config-group">
          <summary className="config-group-summary">上游与图像服务</summary>
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">可选 Gateway 地址
            <input value={settings.affGatewayUrl} onChange={(event) => setSettings({ ...settings, affGatewayUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="不用 Gateway 请留空" />
          </label>
          <label className="block text-sm font-semibold">可选 Gateway 令牌
            <input value={settings.affGatewayToken} onChange={(event) => setSettings({ ...settings, affGatewayToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="不用 Gateway 请留空" />
          </label>
          <label className="block text-sm font-semibold">第三方 API 站点
            <input value={settings.naiApiUrl} onChange={(event) => setSettings({ ...settings, naiApiUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="账号/订阅默认走这里，可与 Gateway 相同" />
          </label>
          <label className="block text-sm font-semibold">第三方 API 站点令牌
            <input value={settings.naiApiToken} onChange={(event) => setSettings({ ...settings, naiApiToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="Gateway Token，浏览器不会看到" />
          </label>
          <label className="block text-sm font-semibold">图像 API 站点（可选）
            <input value={settings.naiImageApiUrl} onChange={(event) => setSettings({ ...settings, naiImageApiUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="只填时生图走这里；留空则用第三方 API 站点" />
          </label>
          <label className="block text-sm font-semibold">图像 API 站点令牌
            <input value={settings.naiImageApiToken} onChange={(event) => setSettings({ ...settings, naiImageApiToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="可与第三方 API 站点共用 Gateway Token" />
          </label>
          <label className="block text-sm font-semibold">可选通用图像上游
            <input value={settings.imageProviderUrl} onChange={(event) => setSettings({ ...settings, imageProviderUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="OpenAI 兼容 /v1，没有请留空" />
          </label>
          <label className="block text-sm font-semibold">可选图像上游令牌
            <input value={settings.imageProviderToken} onChange={(event) => setSettings({ ...settings, imageProviderToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="没有请留空" />
          </label>
          </div>
        </details>
        <details open className="config-group">
          <summary className="config-group-summary">网络、安全与远程历史</summary>
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">远程历史地址
            <input value={settings.remoteHistoryUrl} onChange={(event) => setSettings({ ...settings, remoteHistoryUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold">远程历史令牌
            <input value={settings.remoteHistoryToken} onChange={(event) => setSettings({ ...settings, remoteHistoryToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="留脱敏值表示不改" />
          </label>
          <label className="block text-sm font-semibold">出站代理
            <input value={settings.outboundProxy} onChange={(event) => setSettings({ ...settings, outboundProxy: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="http://host:port" />
          </label>
          <label className="block text-sm font-semibold">源码地址
            <input value={settings.sourceCodeUrl} onChange={(event) => setSettings({ ...settings, sourceCodeUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="flex h-10 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={settings.trustProxy} onChange={(event) => setSettings({ ...settings, trustProxy: event.target.checked })} />
            信任反向代理 X-Forwarded-For
          </label>
          <label className="flex h-10 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={settings.cookieSecure} onChange={(event) => setSettings({ ...settings, cookieSecure: event.target.checked })} />
            Cookie 仅 HTTPS
          </label>
          </div>
        </details>
      </article>

      <article className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
        <h3 className="text-sm font-semibold text-[var(--rose)]">模型与福利</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">关闭模型后会从模型列表下架并拒绝对应请求；签到/邀请奖励单位为 AFF。修改后点击上方「保存站点设置」生效。</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <button type="button" role="switch" aria-checked={settings.enableV5Models} aria-label="启用 V5 模型（nai-v5-*）" className={`token-quota-switch admin-setting-switch ${settings.enableV5Models ? "is-on" : ""}`} onClick={() => setSettings({ ...settings, enableV5Models: !settings.enableV5Models })}>
            <span className="token-quota-switch-track" aria-hidden="true"><span className="token-quota-switch-thumb" /></span>
            <span className="token-quota-switch-label">{settings.enableV5Models ? "启用 V5 模型（nai-v5-*）" : "V5 模型已关闭"}</span>
          </button>
          <button type="button" role="switch" aria-checked={settings.enableV45Models} aria-label="启用 V4.5 模型（nai-v4.5-*）" className={`token-quota-switch admin-setting-switch ${settings.enableV45Models ? "is-on" : ""}`} onClick={() => setSettings({ ...settings, enableV45Models: !settings.enableV45Models })}>
            <span className="token-quota-switch-track" aria-hidden="true"><span className="token-quota-switch-thumb" /></span>
            <span className="token-quota-switch-label">{settings.enableV45Models ? "启用 V4.5 模型（nai-v4.5-*）" : "V4.5 模型已关闭"}</span>
          </button>
          <button type="button" role="switch" aria-checked={settings.enableDailyCheckIn} aria-label="开启每日签到" className={`token-quota-switch admin-setting-switch ${settings.enableDailyCheckIn ? "is-on" : ""}`} onClick={() => setSettings({ ...settings, enableDailyCheckIn: !settings.enableDailyCheckIn })}>
            <span className="token-quota-switch-track" aria-hidden="true"><span className="token-quota-switch-thumb" /></span>
            <span className="token-quota-switch-label">{settings.enableDailyCheckIn ? "开启每日签到" : "每日签到已关闭"}</span>
          </button>
          <label className="block text-sm font-semibold">每日签到奖励（AFF）
            <input type="number" min={0} step="any" value={settings.dailyCheckInReward} onChange={(event) => setSettings({ ...settings, dailyCheckInReward: Number(event.target.value) })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <button type="button" role="switch" aria-checked={settings.enableReferral} aria-label="开启邀请奖励" className={`token-quota-switch admin-setting-switch ${settings.enableReferral ? "is-on" : ""}`} onClick={() => setSettings({ ...settings, enableReferral: !settings.enableReferral })}>
            <span className="token-quota-switch-track" aria-hidden="true"><span className="token-quota-switch-thumb" /></span>
            <span className="token-quota-switch-label">{settings.enableReferral ? "开启邀请奖励" : "邀请奖励已关闭"}</span>
          </button>
          <label className="block text-sm font-semibold">邀请奖励（AFF，邀请人与新用户各得）
            <input type="number" min={0} step="any" value={settings.referralReward} onChange={(event) => setSettings({ ...settings, referralReward: Number(event.target.value) })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <button type="button" role="switch" aria-checked={settings.watermarkEnabled} aria-label="启用 Love-for-NAI 图片签名" className={`token-quota-switch admin-setting-switch ${settings.watermarkEnabled ? "is-on" : ""}`} onClick={() => setSettings({ ...settings, watermarkEnabled: !settings.watermarkEnabled })}>
            <span className="token-quota-switch-track" aria-hidden="true"><span className="token-quota-switch-thumb" /></span>
            <span className="token-quota-switch-label">{settings.watermarkEnabled ? "启用 Love-for-NAI 图片签名" : "图片签名已关闭"}</span>
          </button>
          <label className="block text-sm font-semibold">签名发行方
            <input value={settings.watermarkIssuer} onChange={(event) => setSettings({ ...settings, watermarkIssuer: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold">签名标签
            <input value={settings.watermarkLabel} onChange={(event) => setSettings({ ...settings, watermarkLabel: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold sm:col-span-2">签名附加说明
            <input value={settings.watermarkNote} onChange={(event) => setSettings({ ...settings, watermarkNote: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
        </div>
      </article>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">端点才是实际接入。图像端点可只开 OpenAI 兼容接口，不必开 Gateway；停用或删除即可切走。</p>
        <button type="button" onClick={() => setEditing(emptyForm())} className="flex h-10 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-semibold text-[var(--rose)] hover:border-[var(--rose)]">
          <Plus size={15} />添加端点
        </button>
      </div>

      {Object.keys(TYPE_LABELS).map((type) => {
        const items = grouped[type] || [];
        return (
          <section key={type} className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--rose)]">{TYPE_LABELS[type]}（{items.length}）</h3>
            {!items.length && <p className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel)] px-4 py-6 text-center text-sm text-[var(--muted)]">还没有{TYPE_LABELS[type]}端点</p>}
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <b>{item.name}</b>
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px]">{item.adapterType}</span>
                    <span className={`text-[10px] font-semibold ${item.enabled ? "text-[var(--mint)]" : "text-[var(--muted)]"}`}>
                      {item.enabled ? "启用" : "停用"}
                    </span>
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {item.config.baseUrl || "无地址"} · 优先级 {item.priority}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => toggleEndpoint(item)} className="grid h-10 w-10 place-items-center rounded border border-[var(--line)] bg-[var(--panel)] hover:border-[var(--rose)]" title={item.enabled ? "停用" : "启用"}>
                    {item.enabled ? <PowerOff size={15} /> : <Power size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing({
                      id: item.id,
                      type: item.type,
                      adapterType: item.adapterType,
                      name: item.name,
                      baseUrl: item.config.baseUrl || "",
                      token: item.config.token || "",
                      priority: String(item.priority),
                      enabled: item.enabled,
                    })}
                    className="grid h-10 w-10 place-items-center rounded border border-[var(--line)] bg-[var(--panel)] hover:border-[var(--rose)]"
                    title="编辑"
                  >
                    <Pencil size={15} />
                  </button>
                  <button type="button" onClick={() => removeEndpoint(item)} className="grid h-10 w-10 place-items-center rounded border border-red-200 bg-[var(--panel)] text-red-600 hover:border-red-400" title="删除">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {editing && (
        <div className="fixed inset-0 z-[30000] grid place-items-center bg-[var(--ink)]/45 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-lg border border-[var(--line)] bg-[var(--panel)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-muted)] px-5 py-4">
              <b>{editing.id ? "编辑端点" : "添加端点"}</b>
              <button type="button" onClick={() => setEditing(null)} className="text-sm text-[var(--muted)]">关闭</button>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm">
              <label className="block font-semibold">类型
                <div className="mt-1.5">
                  <PopupSelect
                    value={editing.type}
                    onChange={(value) => {
                      const type = value as EndpointForm["type"];
                      setEditing({ ...editing, type, adapterType: ADAPTER_TYPES[type][0].value });
                    }}
                    ariaLabel="端点类型"
                    options={[
                      { value: "auth", label: "认证系统" },
                      { value: "image", label: "图像生成" },
                      { value: "wallet", label: "钱包计费" },
                    ]}
                  />
                </div>
              </label>
              <label className="block font-semibold">适配器
                <div className="mt-1.5">
                  <PopupSelect
                    value={editing.adapterType}
                    onChange={(value) => setEditing({ ...editing, adapterType: value })}
                    ariaLabel="适配器"
                    options={ADAPTER_TYPES[editing.type]}
                  />
                </div>
              </label>
              <label className="block font-semibold">名称
                <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
              </label>
              <label className="block font-semibold">地址
                <input value={editing.baseUrl} onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="本地账号可留空" />
              </label>
              <label className="block font-semibold">令牌
                <input value={editing.token} onChange={(event) => setEditing({ ...editing, token: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="留脱敏值表示不改" />
              </label>
              <label className="block font-semibold">优先级
                <input value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
              </label>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} />
                启用
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3.5">
              <button type="button" onClick={() => setEditing(null)} className="h-10 rounded border border-[var(--line)] bg-[var(--panel)] px-4 text-sm font-semibold">取消</button>
              <button type="button" disabled={saving} onClick={saveEndpoint} className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
                <Save size={15} />{saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  affGatewayUrl: string;
  affGatewayToken: string;
  imageProviderUrl: string;
  imageProviderToken: string;
  publicUrl: string;
  sourceCodeUrl: string;
  outboundProxy: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  remoteHistoryUrl: string;
  remoteHistoryToken: string;
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
  registerGroup: "Draw",
  quotaPerUnit: 500000,
  affGatewayUrl: "",
  affGatewayToken: "",
  imageProviderUrl: "",
  imageProviderToken: "",
  publicUrl: "",
  sourceCodeUrl: "",
  outboundProxy: "",
  trustProxy: false,
  cookieSecure: false,
  remoteHistoryUrl: "",
  remoteHistoryToken: "",
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
      await load();
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
      <article className="rounded-lg border border-[var(--line)] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">站点设置</p>
            <p className="mt-1 text-sm text-[var(--muted)]">账号、上游、余额单位、Cookie 和远程历史都可在这里改，保存后立即生效。密钥留脱敏值表示保持不变。</p>
          </div>
          <button type="button" disabled={saving} onClick={saveSettings} className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
            <Save size={15} />{saving ? "保存中…" : "保存设置"}
          </button>
        </div>
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
            <input value={settings.registerGroup} onChange={(event) => setSettings({ ...settings, registerGroup: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
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
          <label className="block text-sm font-semibold">公开地址
            <input value={settings.publicUrl} onChange={(event) => setSettings({ ...settings, publicUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold">Gateway 地址
            <input value={settings.affGatewayUrl} onChange={(event) => setSettings({ ...settings, affGatewayUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="http://novelai-gateway:41555/v1" />
          </label>
          <label className="block text-sm font-semibold">Gateway 令牌
            <input value={settings.affGatewayToken} onChange={(event) => setSettings({ ...settings, affGatewayToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="留脱敏值表示不改" />
          </label>
          <label className="block text-sm font-semibold">通用图像上游
            <input value={settings.imageProviderUrl} onChange={(event) => setSettings({ ...settings, imageProviderUrl: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block text-sm font-semibold">图像上游令牌
            <input value={settings.imageProviderToken} onChange={(event) => setSettings({ ...settings, imageProviderToken: event.target.value })} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="留脱敏值表示不改" />
          </label>
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
      </article>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">端点决定实际走哪家认证、出图和钱包。可添加多条，优先级高的先用。</p>
        <button type="button" onClick={() => setEditing(emptyForm())} className="flex h-10 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold text-[var(--rose)] hover:border-[var(--rose)]">
          <Plus size={15} />添加端点
        </button>
      </div>

      {Object.keys(TYPE_LABELS).map((type) => {
        const items = grouped[type] || [];
        return (
          <section key={type} className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--rose)]">{TYPE_LABELS[type]}（{items.length}）</h3>
            {!items.length && <p className="rounded-lg border border-dashed border-[var(--line)] bg-white px-4 py-6 text-center text-sm text-[var(--muted)]">还没有{TYPE_LABELS[type]}端点</p>}
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <b>{item.name}</b>
                    <span className="rounded-full bg-[#f1eee7] px-2 py-0.5 text-[10px]">{item.adapterType}</span>
                    <span className={`text-[10px] font-semibold ${item.enabled ? "text-[var(--mint)]" : "text-[var(--muted)]"}`}>
                      {item.enabled ? "启用" : "停用"}
                    </span>
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {item.config.baseUrl || "无地址"} · 优先级 {item.priority}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => toggleEndpoint(item)} className="grid h-10 w-10 place-items-center rounded border border-[var(--line)] bg-white hover:border-[var(--rose)]" title={item.enabled ? "停用" : "启用"}>
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
                    className="grid h-10 w-10 place-items-center rounded border border-[var(--line)] bg-white hover:border-[var(--rose)]"
                    title="编辑"
                  >
                    <Pencil size={15} />
                  </button>
                  <button type="button" onClick={() => removeEndpoint(item)} className="grid h-10 w-10 place-items-center rounded border border-red-200 bg-white text-red-600 hover:border-red-400" title="删除">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {editing && (
        <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-lg border border-[var(--line)] bg-[#fffefa]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
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
            <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[#f5f3ed] px-5 py-3.5">
              <button type="button" onClick={() => setEditing(null)} className="h-10 rounded border border-[var(--line)] bg-white px-4 text-sm font-semibold">取消</button>
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

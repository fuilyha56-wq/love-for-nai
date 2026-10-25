"use client";
import { AdminModal } from "./ui/admin-primitives";
import { lfnConfirm } from "@/mobile/ui/lfn-dialog";

import { Pencil, Plus, Power, PowerOff, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PopupSelect } from "@/mobile/ui/popup-select";

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

const ADAPTER_TYPES: Record<
  string,
  Array<{ value: string; label: string; description: string }>
> = {
  auth: [
    {
      value: "newapi",
      label: "NewAPI",
      description: "沿用现有账号、分组和余额",
    },
    {
      value: "local",
      label: "本地账号",
      description: "LFN 自管用户，不依赖 NewAPI",
    },
  ],
  image: [
    {
      value: "gateway",
      label: "NovelAI Gateway",
      description: "额度足够时直连 Gateway 出图",
    },
    {
      value: "openai_compat",
      label: "OpenAI 兼容接口",
      description: "任意 /v1/images/generations 服务",
    },
  ],
  wallet: [
    {
      value: "newapi",
      label: "NewAPI 余额",
      description: "上游 quota，配合 AFF / 图包",
    },
  ],
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

export default function EndpointConfigPanel({
  setMessage,
}: {
  setMessage: (msg: string) => void;
}) {
  const [endpoints, setEndpoints] = useState<EndpointConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EndpointForm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const endpointsResponse = await fetch("/api/admin/platform/endpoints", {
        cache: "no-store",
      });
      const endpointsResult = await endpointsResponse.json();
      if (!endpointsResponse.ok) {
        setMessage(endpointsResult.message || "端点读取失败");
        return;
      }
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
    if (!(await lfnConfirm(`确定删除端点「${item.name}」？`))) return;
    const response = await fetch(
      `/api/admin/platform/endpoints?id=${encodeURIComponent(item.id)}`,
      {
        method: "DELETE",
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.message || "删除失败");
      return;
    }
    setMessage("端点已删除");
    await load();
  }

  const grouped = endpoints.reduce<Record<string, EndpointConfig[]>>(
    (acc, item) => {
      (acc[item.type] ||= []).push(item);
      return acc;
    },
    {},
  );

  if (loading) return <p className="text-sm text-[var(--muted)]">加载中…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">
          端点才是实际接入。图像端点可只开 OpenAI 兼容接口，不必开
          Gateway；停用或删除即可切走。
        </p>
        <button
          type="button"
          onClick={() => setEditing(emptyForm())}
          className="flex h-10 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-semibold text-[var(--rose)] hover:border-[var(--rose)]"
        >
          <Plus size={15} />
          添加端点
        </button>
      </div>

      {Object.keys(TYPE_LABELS).map((type) => {
        const items = grouped[type] || [];
        return (
          <section key={type} className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--rose)]">
              {TYPE_LABELS[type]}（{items.length}）
            </h3>
            {!items.length && (
              <p className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel)] px-4 py-6 text-center text-sm text-[var(--muted)]">
                还没有{TYPE_LABELS[type]}端点
              </p>
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <b>{item.name}</b>
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px]">
                      {item.adapterType}
                    </span>
                    <span
                      className={`text-[10px] font-semibold ${item.enabled ? "text-[var(--mint)]" : "text-[var(--muted)]"}`}
                    >
                      {item.enabled ? "启用" : "停用"}
                    </span>
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {item.config.baseUrl || "无地址"} · 优先级 {item.priority}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => toggleEndpoint(item)}
                    className="grid h-10 w-10 place-items-center rounded border border-[var(--line)] bg-[var(--panel)] hover:border-[var(--rose)]"
                    title={item.enabled ? "停用" : "启用"}
                  >
                    {item.enabled ? (
                      <PowerOff size={15} />
                    ) : (
                      <Power size={15} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: item.id,
                        type: item.type,
                        adapterType: item.adapterType,
                        name: item.name,
                        baseUrl: item.config.baseUrl || "",
                        token: item.config.token || "",
                        priority: String(item.priority),
                        enabled: item.enabled,
                      })
                    }
                    className="grid h-10 w-10 place-items-center rounded border border-[var(--line)] bg-[var(--panel)] hover:border-[var(--rose)]"
                    title="编辑"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEndpoint(item)}
                    className="grid h-10 w-10 place-items-center rounded border border-red-200 bg-[var(--panel)] text-red-600 hover:border-red-400"
                    title="删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {editing && (
        <AdminModal
          label={editing.id ? "编辑端点" : "添加端点"}
          onClose={() => setEditing(null)}
        >
          <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-muted)] px-5 py-4">
            <b>{editing.id ? "编辑端点" : "添加端点"}</b>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-sm text-[var(--muted)]"
            >
              关闭
            </button>
          </div>
          <div className="space-y-4 px-5 py-4 text-sm">
            <label className="block font-semibold">
              类型
              <div className="mt-1.5">
                <PopupSelect
                  value={editing.type}
                  onChange={(value) => {
                    const type = value as EndpointForm["type"];
                    setEditing({
                      ...editing,
                      type,
                      adapterType: ADAPTER_TYPES[type][0].value,
                    });
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
            <label className="block font-semibold">
              适配器
              <div className="mt-1.5">
                <PopupSelect
                  value={editing.adapterType}
                  onChange={(value) =>
                    setEditing({ ...editing, adapterType: value })
                  }
                  ariaLabel="适配器"
                  options={ADAPTER_TYPES[editing.type]}
                />
              </div>
            </label>
            <label className="block font-semibold">
              名称
              <input
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                className="field mt-1.5 h-10 w-full px-3 text-sm"
              />
            </label>
            <label className="block font-semibold">
              地址
              <input
                value={editing.baseUrl}
                onChange={(event) =>
                  setEditing({ ...editing, baseUrl: event.target.value })
                }
                className="field mt-1.5 h-10 w-full px-3 text-sm"
                placeholder="本地账号可留空"
              />
            </label>
            <label className="block font-semibold">
              令牌
              <input
                value={editing.token}
                onChange={(event) =>
                  setEditing({ ...editing, token: event.target.value })
                }
                className="field mt-1.5 h-10 w-full px-3 text-sm"
                placeholder="留脱敏值表示不改"
              />
            </label>
            <label className="block font-semibold">
              优先级
              <input
                value={editing.priority}
                onChange={(event) =>
                  setEditing({ ...editing, priority: event.target.value })
                }
                className="field mt-1.5 h-10 w-full px-3 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(event) =>
                  setEditing({ ...editing, enabled: event.target.checked })
                }
              />
              启用
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3.5">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="h-10 rounded border border-[var(--line)] bg-[var(--panel)] px-4 text-sm font-semibold"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={saveEndpoint}
              className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Save size={15} />
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </AdminModal>
      )}
    </div>
  );
}

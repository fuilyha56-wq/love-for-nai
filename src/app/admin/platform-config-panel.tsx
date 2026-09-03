"use client";

import { Plus, Save, Trash2, Power, PowerOff } from "lucide-react";
import { useEffect, useState } from "react";

type EndpointConfig = {
  id: string;
  type: "auth" | "image" | "wallet";
  adapterType: string;
  name: string;
  enabled: boolean;
  config: {
    baseUrl?: string;
    token?: string;
    apiKey?: string;
    secretKey?: string;
    extra?: Record<string, unknown>;
  };
  priority: number;
  createdAt: string;
  updatedAt: string;
};

type EndpointFormData = {
  type: "auth" | "image" | "wallet";
  adapterType: string;
  name: string;
  baseUrl: string;
  token: string;
  priority: number;
};

const TYPE_LABELS: Record<string, string> = {
  auth: "认证系统",
  image: "图像生成",
  wallet: "钱包计费",
};

const ADAPTER_TYPES: Record<string, Array<{ value: string; label: string }>> = {
  auth: [
    { value: "newapi", label: "NewAPI" },
    { value: "local", label: "本地数据库" },
  ],
  image: [
    { value: "openai_compat", label: "OpenAI 兼容接口" },
    { value: "gateway", label: "NovelAI Gateway" },
  ],
  wallet: [
    { value: "newapi", label: "NewAPI + AFF" },
  ],
};

export default function PlatformConfigPanel({ setMessage }: { setMessage: (msg: string) => void }) {
  const [endpoints, setEndpoints] = useState<EndpointConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<EndpointFormData>({
    type: "image",
    adapterType: "openai_compat",
    name: "",
    baseUrl: "",
    token: "",
    priority: 50,
  });

  const loadEndpoints = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/platform/endpoints", { cache: "no-store" });
      const result = await response.json();
      if (response.ok) {
        setEndpoints(result.endpoints || []);
      } else {
        setMessage(result.error || "加载端点配置失败");
      }
    } catch {
      setMessage("加载端点配置失败");
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadEndpoints();
  }, []);

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.baseUrl.trim() || !formData.token.trim()) {
      setMessage("请填写完整的端点信息");
      return;
    }

    try {
      const response = await fetch("/api/admin/platform/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formData.type,
          adapterType: formData.adapterType,
          name: formData.name,
          config: {
            baseUrl: formData.baseUrl,
            token: formData.token,
          },
          priority: formData.priority,
        }),
      });

      const result = await response.json();
      if (response.ok) {
        setMessage("端点创建成功");
        setShowForm(false);
        setFormData({
          type: "image",
          adapterType: "openai_compat",
          name: "",
          baseUrl: "",
          token: "",
          priority: 50,
        });
        await loadEndpoints();
      } else {
        setMessage(result.error || "创建失败");
      }
    } catch {
      setMessage("创建端点失败");
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const response = await fetch("/api/admin/platform/endpoints", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: !enabled }),
      });

      const result = await response.json();
      if (response.ok) {
        setMessage(enabled ? "端点已停用" : "端点已启用");
        await loadEndpoints();
      } else {
        setMessage(result.error || "切换失败");
      }
    } catch {
      setMessage("切换端点状态失败");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除端点「${name}」吗？`)) return;

    try {
      const response = await fetch(`/api/admin/platform/endpoints?id=${id}`, {
        method: "DELETE",
      });

      const result = await response.json();
      if (response.ok) {
        setMessage("端点已删除");
        await loadEndpoints();
      } else {
        setMessage(result.error || "删除失败");
      }
    } catch {
      setMessage("删除端点失败");
    }
  };

  const groupedEndpoints = endpoints.reduce(
    (acc, endpoint) => {
      if (!acc[endpoint.type]) acc[endpoint.type] = [];
      acc[endpoint.type].push(endpoint);
      return acc;
    },
    {} as Record<string, EndpointConfig[]>
  );

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">加载中…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">
          管理 LFN 接入的第三方服务端点，支持多个同类端点（按优先级生效）
        </p>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="flex h-9 shrink-0 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold hover:border-[var(--rose)]"
        >
          <Plus size={16} />
          添加端点
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-[var(--line)] bg-white p-5">
          <p className="mb-4 text-sm font-semibold">新增端点</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--muted)]">端点类型</span>
              <select
                value={formData.type}
                onChange={(e) => {
                  const type = e.target.value as "auth" | "image" | "wallet";
                  setFormData({
                    ...formData,
                    type,
                    adapterType: ADAPTER_TYPES[type][0].value,
                  });
                }}
                className="h-10 w-full rounded border border-[var(--line)] px-3 text-sm"
              >
                <option value="auth">认证系统</option>
                <option value="image">图像生成</option>
                <option value="wallet">钱包计费</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--muted)]">适配器类型</span>
              <select
                value={formData.adapterType}
                onChange={(e) => setFormData({ ...formData, adapterType: e.target.value })}
                className="h-10 w-full rounded border border-[var(--line)] px-3 text-sm"
              >
                {ADAPTER_TYPES[formData.type].map((adapter) => (
                  <option key={adapter.value} value={adapter.value}>
                    {adapter.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-[var(--muted)]">端点名称</span>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="例如：主图像服务"
                className="h-10 w-full rounded border border-[var(--line)] px-3 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-[var(--muted)]">Base URL</span>
              <input
                type="text"
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                placeholder="https://api.example.com"
                className="h-10 w-full rounded border border-[var(--line)] px-3 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs text-[var(--muted)]">Token / API Key</span>
              <input
                type="password"
                value={formData.token}
                onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                placeholder="sk-***"
                className="h-10 w-full rounded border border-[var(--line)] px-3 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--muted)]">优先级（越高越优先）</span>
              <input
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                className="h-10 w-full rounded border border-[var(--line)] px-3 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              className="flex h-9 items-center gap-2 rounded border border-[var(--rose)] bg-[var(--rose)] px-4 text-sm font-semibold text-white hover:bg-[var(--rose-dark)]"
            >
              <Save size={16} />
              保存
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-9 rounded border border-[var(--line)] px-4 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {Object.keys(TYPE_LABELS).map((type) => {
        const items = groupedEndpoints[type] || [];
        return (
          <div key={type} className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--rose)]">
              {TYPE_LABELS[type]} ({items.length})
            </h3>
            {items.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">暂无 {TYPE_LABELS[type]} 端点</p>
            ) : (
              <div className="space-y-2">
                {items.map((endpoint) => (
                  <div
                    key={endpoint.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-white p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{endpoint.name}</p>
                        <span className="rounded bg-[var(--paper)] px-2 py-0.5 text-xs text-[var(--muted)]">
                          {endpoint.adapterType}
                        </span>
                        {endpoint.enabled ? (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <Power size={12} />
                            启用
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-[var(--muted)]">
                            <PowerOff size={12} />
                            停用
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--muted)]">
                        {endpoint.config.baseUrl || "—"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        优先级: {endpoint.priority} · 创建于{" "}
                        {new Date(endpoint.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggle(endpoint.id, endpoint.enabled)}
                        className="flex h-9 items-center gap-1 rounded border border-[var(--line)] px-3 text-sm hover:border-[var(--rose)]"
                        title={endpoint.enabled ? "停用" : "启用"}
                      >
                        {endpoint.enabled ? <PowerOff size={16} /> : <Power size={16} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(endpoint.id, endpoint.name)}
                        className="flex h-9 items-center gap-1 rounded border border-red-200 px-3 text-sm text-red-600 hover:border-red-400"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

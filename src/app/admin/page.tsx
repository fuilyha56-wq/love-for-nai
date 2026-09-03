"use client";

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  MessageCircle,
  Pin,
  Plus,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MarkdownView } from "@/app/markdown";
import type { AnnouncementItem } from "@/app/announcement-dialog";
import CommentsDialog from "./comments-dialog";

type AdminUser = {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  role?: number;
  status?: number;
  quota?: number;
  group?: string;
  remark?: string;
  created_at?: number;
  aff?: { balance: number } | null;
};

type Tab = "overview" | "users" | "announcements";
type AdminModule = { id: Tab | string; label: string; description: string; enabled: boolean };
type PlatformCapabilities = {
  auth: { label: string; provider: string };
  image: { label: string; enabled: boolean };
  wallet: { upstreamBalance: boolean; credits: boolean; packages: boolean };
};

const DEFAULT_QUOTA_PER_UNIT = 500000;
const ROLE_LABELS: Record<number, string> = { 1: "用户", 10: "管理员", 100: "Root" };

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [denied, setDenied] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin")
      .then((response) => response.json())
      .then((result) => {
        if (cancelled) return;
        setDenied(!result.admin);
        if (Array.isArray(result.modules)) setModules(result.modules);
        if (result.capabilities) setCapabilities(result.capabilities);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (denied === null)
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--paper)] text-sm text-[var(--muted)]">
        正在验证管理员身份…
      </main>
    );

  if (denied)
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--paper)] p-6 text-[var(--ink)]">
        <div className="max-w-sm rounded-lg border border-[var(--line)] bg-white p-8 text-center">
          <ShieldCheck size={34} className="mx-auto text-[var(--rose)]" />
          <h1 className="mt-4 text-lg font-bold">仅管理员可用</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">此界面仅对站点管理员开放，不绑定某一家上游。</p>
          <Link href="/image" className="mt-5 inline-flex h-9 items-center gap-2 rounded border border-[var(--line)] px-4 text-sm font-semibold hover:border-[var(--rose)]">
            <ArrowLeft size={15} /> 返回工作台
          </Link>
        </div>
      </main>
    );

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <ShieldCheck size={20} className="shrink-0 text-[var(--rose)]" />
          <b className="truncate">LFN 管理中心</b>
        </div>
        <Link href="/image" className="flex h-9 shrink-0 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold hover:border-[var(--rose)]">
          <ArrowLeft size={16} />
          返回工作台
        </Link>
      </header>
      {message && (
        <p className="mx-auto mt-4 max-w-6xl rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</p>
      )}
      <div className="mx-auto max-w-6xl p-4 sm:p-7">
        <div className="mb-5 flex gap-1 rounded-md border border-[var(--line)] bg-[#f5f3ed] p-1 text-xs font-semibold">
          {(modules.length ? modules : [
            { id: "overview", label: "平台概览", description: "", enabled: true },
            { id: "users", label: "用户管理", description: "", enabled: true },
            { id: "announcements", label: "公告管理", description: "", enabled: true },
          ]).filter((item) => item.enabled).map((item) => (
            <button key={item.id} type="button" onClick={() => setTab(item.id as Tab)} className={`h-8 flex-1 rounded ${tab === item.id ? "bg-white text-[var(--rose)] shadow-sm" : "text-[var(--muted)]"}`}>
              {item.label}
            </button>
          ))}
        </div>
        {tab === "overview" ? (
          <OverviewPanel capabilities={capabilities} modules={modules} />
        ) : tab === "users" ? (
          <UsersPanel setMessage={setMessage} />
        ) : (
          <AnnouncementsPanel setMessage={setMessage} />
        )}
      </div>
    </main>
  );
}

function OverviewPanel({
  capabilities,
  modules,
}: {
  capabilities: PlatformCapabilities | null;
  modules: AdminModule[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <article className="rounded-lg border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">AUTH</p>
        <h2 className="mt-2 text-lg font-semibold">{capabilities?.auth.label || "账号能力"}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">当前账号提供者：{capabilities?.auth.provider || "未读取"}。可替换为本地账号或其他登录后端。</p>
      </article>
      <article className="rounded-lg border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">IMAGE</p>
        <h2 className="mt-2 text-lg font-semibold">{capabilities?.image.label || "图像上游"}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{capabilities?.image.enabled ? "已接入图像生成上游。" : "尚未配置图像上游，工作台仍可浏览但不能真实出图。"}</p>
      </article>
      <article className="rounded-lg border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">ADMIN</p>
        <h2 className="mt-2 text-lg font-semibold">可扩展模块</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{modules.filter((item) => item.enabled).map((item) => item.label).join("、") || "公告、用户、额度"} 均可独立开关。</p>
      </article>
    </div>
  );
}

function UsersPanel({ setMessage }: { setMessage: (text: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [quotaPerUnit, setQuotaPerUnit] = useState(DEFAULT_QUOTA_PER_UNIT);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const pageSize = 20;

  const load = useCallback(
    async (targetPage: number, search: string) => {
      try {
        const query = new URLSearchParams({ p: String(targetPage), size: String(pageSize) });
        if (search) query.set("keyword", search);
        const response = await fetch(`/api/admin/users?${query}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) {
          setMessage(result.message || "用户列表读取失败");
          return;
        }
        setUsers(result.items || []);
        setTotal(result.total || 0);
        if (Number.isFinite(result.quotaPerUnit) && result.quotaPerUnit > 0)
          setQuotaPerUnit(result.quotaPerUnit);
      } catch {
        setMessage("用户列表读取失败");
      }
    },
    [pageSize, setMessage],
  );

  useEffect(() => {
    // 首次加载交给微任务，避免 effect 同步链接触发 setState 规则。
    void Promise.resolve().then(() => load(1, ""));
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(1);
              load(1, keyword);
            }
          }}
          placeholder="按用户名 / 邮箱搜索…"
          className="field h-9 w-full px-3 text-sm sm:w-64"
        />
        <button
          type="button"
          onClick={() => {
            setPage(1);
            load(1, keyword);
          }}
          className="h-9 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold hover:border-[var(--rose)]"
        >
          搜索
        </button>
        <span className="ml-auto text-xs text-[var(--muted)]">共 {total} 个用户</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[#f5f3ed] text-left text-xs text-[var(--muted)]">
              <th className="px-3 py-2.5">ID</th>
              <th className="px-3 py-2.5">用户名</th>
              <th className="px-3 py-2.5">分组</th>
              <th className="px-3 py-2.5">角色</th>
              <th className="px-3 py-2.5">余额</th>
              <th className="px-3 py-2.5">AFF</th>
              <th className="px-3 py-2.5">邮箱</th>
              <th className="px-3 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[#faf9f5]">
                <td className="px-3 py-2.5 font-mono text-xs text-[var(--muted)]">{user.id}</td>
                <td className="px-3 py-2.5 font-medium">{user.display_name || user.username}</td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full bg-[#f1eee7] px-2 py-0.5 text-xs">{user.group || "default"}</span>
                </td>
                <td className="px-3 py-2.5 text-xs">{ROLE_LABELS[user.role ?? 1] || user.role}</td>
                <td className="px-3 py-2.5 tabular-nums">${((user.quota || 0) / quotaPerUnit).toFixed(2)}</td>
                <td className="px-3 py-2.5 tabular-nums">{user.aff?.balance ?? "-"}</td>
                <td className="max-w-40 truncate px-3 py-2.5 text-xs text-[var(--muted)]">{user.email || "-"}</td>
                <td className="px-3 py-2.5">
                  <button type="button" onClick={() => setEditing(user)} className="text-xs font-semibold text-[var(--rose)] hover:underline">
                    编辑
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-[var(--muted)]">没有匹配的用户</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-3 text-sm">
        <button type="button" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); load(next, keyword); }} className="grid h-8 w-8 place-items-center rounded border border-[var(--line)] bg-white disabled:opacity-40">
          <ChevronLeft size={15} />
        </button>
        <span className="text-xs text-[var(--muted)]">{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => { const next = page + 1; setPage(next); load(next, keyword); }} className="grid h-8 w-8 place-items-center rounded border border-[var(--line)] bg-white disabled:opacity-40">
          <ChevronRight size={15} />
        </button>
      </div>

      {editing && (
        <EditUserDialog
          user={editing}
          quotaPerUnit={quotaPerUnit}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load(page, keyword);
          }}
          setMessage={setMessage}
        />
      )}
    </div>
  );
}

function EditUserDialog({
  user,
  quotaPerUnit,
  onClose,
  onSaved,
  setMessage,
}: {
  user: AdminUser;
  quotaPerUnit: number;
  onClose: () => void;
  onSaved: () => void;
  setMessage: (text: string) => void;
}) {
  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [password, setPassword] = useState("");
  const [remark, setRemark] = useState(user.remark || "");
  const [group, setGroup] = useState(user.group || "default");
  const [balanceUsd, setBalanceUsd] = useState(
    ((user.quota || 0) / quotaPerUnit).toFixed(2),
  );
  const [affDelta, setAffDelta] = useState("0");
  const [saving, setSaving] = useState(false);

  async function save() {
    const balance = Number(balanceUsd);
    const affChange = Number(affDelta);
    if (!Number.isFinite(balance) || balance < 0) {
      setMessage("NewAPI 余额必须是有效的非负数字");
      return;
    }
    if (!Number.isFinite(affChange) || !Number.isInteger(affChange)) {
      setMessage("AFF 调整必须是整数");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          username: user.username,
          displayName,
          ...(password ? { password } : {}),
          remark,
          group,
          balanceUsd: balance,
          affDelta: affChange,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "保存失败");
        return;
      }
      setMessage(`用户 ${user.username} 已更新`);
      onSaved();
    } catch {
      setMessage("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa] shadow-[0_24px_80px_rgba(50,45,40,.25)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
          <div className="flex items-center gap-2">
            <Users size={17} className="text-[var(--rose)]" />
            <b>编辑用户 · {user.username}</b>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">关闭</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
            <p>ID：{user.id}</p>
            <p>角色：{ROLE_LABELS[user.role ?? 1] || user.role}</p>
            <p className="col-span-2">邮箱：{user.email || "-"}</p>
          </div>
          <label className="block font-semibold">显示名称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">重置密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="留空保持不变" className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">分组
            <input value={group} onChange={(event) => setGroup(event.target.value)} placeholder="default / Draw / vip …" className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">NewAPI 余额（USD）
            <input value={balanceUsd} onChange={(event) => setBalanceUsd(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">AFF 调整（正数发放 / 负数回收，当前 {user.aff?.balance ?? "-"}）
            <input value={affDelta} onChange={(event) => setAffDelta(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">备注
            <textarea value={remark} onChange={(event) => setRemark(event.target.value)} rows={3} className="field mt-1.5 w-full p-3 text-sm" placeholder="管理员备注" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[#f5f3ed] px-5 py-3.5">
          <button type="button" onClick={onClose} className="h-9 rounded border border-[var(--line)] bg-white px-4 text-sm font-semibold">取消</button>
          <button type="button" disabled={saving} onClick={save} className="flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
            <Save size={15} />{saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnnouncementsPanel({ setMessage }: { setMessage: (text: string) => void }) {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [editing, setEditing] = useState<Partial<AnnouncementItem> | null>(null);
  const [commentsFor, setCommentsFor] = useState<AnnouncementItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/announcements", { cache: "no-store" });
      const result = await response.json();
      setItems(result.items || []);
    } catch {
      setMessage("公告读取失败");
    }
  }, [setMessage]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function save() {
    if (!editing) return;
    if (!editing.title?.trim() || !editing.content?.trim()) {
      setMessage("标题和内容不能为空");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const isNew = !editing.id;
      const response = await fetch("/api/announcements/manage", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing.id ? { id: editing.id } : {}),
          title: editing.title,
          content: editing.content,
          level: editing.level || "info",
          pinned: editing.pinned === true,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "保存失败");
        return;
      }
      setMessage(isNew ? "公告已发布" : "公告已更新");
      setEditing(null);
      load();
    } catch {
      setMessage("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("确定删除这条公告？")) return;
    const response = await fetch(`/api/announcements/manage?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.message || "删除失败");
      return;
    }
    setMessage("公告已删除");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold"><Megaphone size={16} className="text-[var(--rose)]" />公告列表（按时间线展示，置顶优先）</p>
        <button type="button" onClick={() => setEditing({ title: "", content: "", level: "info", pinned: false })} className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold text-[var(--rose)] hover:border-[var(--rose)]">
          <Plus size={15} />新建公告
        </button>
      </div>
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-white px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                {item.pinned && <Pin size={13} className="shrink-0 text-[var(--rose)]" />}
                <b className="truncate">{item.title}</b>
                {item.level === "warning" && <span className="shrink-0 rounded-full bg-[#fff3d6] px-2 py-0.5 text-[10px] font-semibold text-[#8a6116]">重要</span>}
              </p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                {new Date(item.createdAt).toLocaleString("zh-CN")} · {item.author}
              </p>
            </div>
            <div className="flex shrink-0 gap-3 text-xs font-semibold">
              <button type="button" onClick={() => setCommentsFor(item)} className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--rose)]"><MessageCircle size={13} />评论</button>
              <button type="button" onClick={() => setEditing(item)} className="text-[var(--rose)] hover:underline">编辑</button>
              <button type="button" onClick={() => remove(item.id)} className="text-red-600 hover:underline">删除</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="py-10 text-center text-sm text-[var(--muted)]">暂无公告</p>}
      </div>

      {commentsFor && (
        <CommentsDialog
          announcement={commentsFor}
          onClose={() => setCommentsFor(null)}
          setMessage={setMessage}
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={() => setEditing(null)}>
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa] shadow-[0_24px_80px_rgba(50,45,40,.25)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
              <b>{editing.id ? "编辑公告" : "新建公告"}</b>
              <button type="button" onClick={() => setEditing(null)} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">关闭</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <input value={editing.title || ""} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="公告标题" className="field h-10 w-full px-3 text-sm font-semibold" />
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={editing.pinned === true} onChange={(event) => setEditing({ ...editing, pinned: event.target.checked })} />
                  置顶
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={editing.level === "warning"} onChange={(event) => setEditing({ ...editing, level: event.target.checked ? "warning" : "info" })} />
                  重要（警示样式）
                </label>
              </div>
              <textarea value={editing.content || ""} onChange={(event) => setEditing({ ...editing, content: event.target.value })} rows={14} placeholder="公告内容（支持 Markdown：## 标题、表格、代码块、列表、**粗体**、[链接](url)）" className="field w-full p-3 font-mono text-xs leading-5" />
              <div className="rounded-lg border border-[var(--line)] bg-white p-4">
                <p className="mb-2 text-xs font-semibold text-[var(--muted)]">预览</p>
                <MarkdownView content={editing.content || ""} />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[#f5f3ed] px-5 py-3.5">
              <button type="button" onClick={() => setEditing(null)} className="h-9 rounded border border-[var(--line)] bg-white px-4 text-sm font-semibold">取消</button>
              <button type="button" disabled={saving} onClick={save} className="flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
                <Save size={15} />{saving ? "保存中…" : "发布"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  ImageIcon,
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
import PlatformConfigPanel from "./platform-config-panel";

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
  aff?: { balance: number; packageBalance?: number } | null;
};

type Tab = "overview" | "users" | "credits" | "announcements" | "gallery" | "referrals" | "platform";
type AdminModule = { id: Tab | string; label: string; description: string; enabled: boolean };
type PlatformCapabilities = {
  auth: { label: string; provider: string };
  image: { label: string; enabled: boolean; provider?: string };
  wallet: { upstreamBalance: boolean; credits: boolean; packages: boolean };
  labels?: { upstreamBalance: string; credits: string; packages: string };
};
type OverviewData = {
  health: { status: string; service: string; auth: string; image: string };
  counts: {
    users: number | null;
    announcements: number;
    comments: number;
    gallery: number;
    referrals: number;
    creditAccounts: number;
  };
  credits: { personal: number; packages: number; checkInReward: number; referralReward: number };
};
type CreditRow = {
  userId: number;
  balance: number;
  packageBalance: number;
  totalBalance: number;
  lastCheckInDay?: string;
  transactionCount: number;
  lastTransactionAt?: string;
};
type CreditDetail = CreditRow & {
  username?: string;
  displayName?: string;
  transactions: Array<{
    id: string;
    createdAt: string;
    amount: number;
    type: string;
    description: string;
    source?: string;
  }>;
};
type GalleryAdminItem = {
  id: string;
  title: string;
  authorName: string;
  ownerName: string;
  ownerId: number;
  rating: "general" | "r13" | "r18";
  source: string;
  tags: string[];
  likes: number;
  createdAt: string;
  imageUrl: string;
};
type ReferralRow = {
  code: string;
  inviterUserId: number;
  inviterName?: string;
  invitedCount: number;
  createdAt: string;
  registeredUserIds: number[];
};

const DEFAULT_QUOTA_PER_UNIT = 500000;
const ROLE_LABELS: Record<number, string> = { 1: "用户", 10: "管理员", 100: "Root" };
const STATUS_LABELS: Record<number, string> = { 1: "正常", 0: "停用" };
const RATING_LABELS: Record<string, string> = { general: "全年龄", r13: "R13", r18: "R18" };

function creditLabel(capabilities: PlatformCapabilities | null) {
  return capabilities?.labels?.credits || "创作额度";
}
function balanceLabel(capabilities: PlatformCapabilities | null) {
  return capabilities?.labels?.upstreamBalance || "上游余额";
}
function packageLabel(capabilities: PlatformCapabilities | null) {
  return capabilities?.labels?.packages || "图包额度";
}

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

  const visibleModules = (modules.length
    ? modules
    : [
        { id: "overview", label: "平台概览", description: "站点健康和运营数字", enabled: true },
        { id: "users", label: "用户管理", description: "账号、角色和额度", enabled: true },
        { id: "credits", label: "创作额度账本", description: "发放、回收和流水", enabled: true },
        { id: "announcements", label: "公告管理", description: "公告与评论", enabled: true },
        { id: "gallery", label: "图库管理", description: "投稿与下架", enabled: true },
        { id: "referrals", label: "邀请记录", description: "邀请码与注册人数", enabled: true },
        { id: "platform", label: "平台配置", description: "查看当前接入的账号、图像和钱包上游", enabled: true },
      ]
  ).filter((item) => item.enabled);
  const current = visibleModules.find((item) => item.id === tab);

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
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-[var(--line)] bg-[#f5f3ed] p-1 text-xs font-semibold sm:grid-cols-3 lg:grid-cols-7">
          {visibleModules.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as Tab)}
              className={`h-8 rounded px-2 ${tab === item.id ? "bg-white text-[var(--rose)] shadow-sm" : "text-[var(--muted)]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {current?.description && (
          <p className="mb-5 text-sm leading-6 text-[var(--muted)]">{current.description}</p>
        )}
        {tab === "overview" ? (
          <OverviewPanel capabilities={capabilities} modules={visibleModules} />
        ) : tab === "users" ? (
          <UsersPanel capabilities={capabilities} setMessage={setMessage} />
        ) : tab === "credits" ? (
          <CreditsPanel capabilities={capabilities} setMessage={setMessage} />
        ) : tab === "gallery" ? (
          <GalleryPanel setMessage={setMessage} />
        ) : tab === "referrals" ? (
          <ReferralsPanel />
        ) : tab === "platform" ? (
          <PlatformConfigPanel setMessage={setMessage} />
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
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const response = await fetch("/api/admin/overview", { cache: "no-store" });
        const result = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(result.message || "概览读取失败");
          return;
        }
        setData(result);
      } catch {
        if (!cancelled) setError("概览读取失败");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = data?.counts;
  const stats = [
    { label: "用户", value: counts?.users == null ? "上游账号" : String(counts.users) },
    { label: "公告", value: counts ? String(counts.announcements) : "…" },
    { label: "评论", value: counts ? String(counts.comments) : "…" },
    { label: "图库作品", value: counts ? String(counts.gallery) : "…" },
    { label: "邀请码", value: counts ? String(counts.referrals) : "…" },
    { label: "额度账本", value: counts ? String(counts.creditAccounts) : "…" },
  ];

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((item) => (
          <article key={item.label} className="rounded-lg border border-[var(--line)] bg-white px-4 py-3">
            <p className="text-xs text-[var(--muted)]">{item.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{item.value}</p>
          </article>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <article className="rounded-lg border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">接入状态</p>
          <dl className="mt-3 divide-y divide-[var(--line)] text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">账号</dt>
              <dd>{capabilities?.auth.label || "未读取"}（{data?.health.auth || capabilities?.auth.provider || "—"}）</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">图像上游</dt>
              <dd>{capabilities?.image.label || "未读取"}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">{balanceLabel(capabilities)}</dt>
              <dd>{capabilities?.wallet.upstreamBalance ? "已接入" : "关闭"}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">{packageLabel(capabilities)}</dt>
              <dd>{capabilities?.wallet.packages ? "可购买" : "关闭"}</dd>
            </div>
          </dl>
        </article>
        <article className="rounded-lg border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">额度规则</p>
          <dl className="mt-3 divide-y divide-[var(--line)] text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">个人{creditLabel(capabilities)}</dt>
              <dd className="tabular-nums">{data ? data.credits.personal : "…"}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">{packageLabel(capabilities)}</dt>
              <dd className="tabular-nums">{data ? data.credits.packages : "…"}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">每日签到</dt>
              <dd>+{data?.credits.checkInReward ?? 20}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--muted)]">邀请双方各得</dt>
              <dd>+{data?.credits.referralReward ?? 100}</dd>
            </div>
          </dl>
        </article>
      </div>
      <article className="rounded-lg border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">管理模块</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {modules.map((item) => (
            <li key={item.id} className="rounded border border-[var(--line)] bg-[#faf9f5] px-3 py-2">
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.description}</p>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}

function UsersPanel({
  capabilities,
  setMessage,
}: {
  capabilities: PlatformCapabilities | null;
  setMessage: (text: string) => void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [quotaPerUnit, setQuotaPerUnit] = useState(DEFAULT_QUOTA_PER_UNIT);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const pageSize = 20;
  const localAuth = capabilities?.auth.provider === "local";
  const showUpstream = capabilities?.wallet.upstreamBalance !== false;

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
        {localAuth && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold text-[var(--rose)] hover:border-[var(--rose)]"
          >
            <Plus size={15} />新建用户
          </button>
        )}
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
              {localAuth && <th className="px-3 py-2.5">状态</th>}
              {showUpstream && <th className="px-3 py-2.5">{balanceLabel(capabilities)}</th>}
              <th className="px-3 py-2.5">{creditLabel(capabilities)}</th>
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
                {localAuth && (
                  <td className="px-3 py-2.5 text-xs">{STATUS_LABELS[user.status ?? 1] || user.status}</td>
                )}
                {showUpstream && (
                  <td className="px-3 py-2.5 tabular-nums">${((user.quota || 0) / quotaPerUnit).toFixed(2)}</td>
                )}
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
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-[var(--muted)]">没有匹配的用户</td>
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

      {creating && (
        <CreateUserDialog
          capabilities={capabilities}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load(page, keyword);
          }}
          setMessage={setMessage}
        />
      )}
      {editing && (
        <EditUserDialog
          user={editing}
          quotaPerUnit={quotaPerUnit}
          capabilities={capabilities}
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

function CreateUserDialog({
  capabilities,
  onClose,
  onSaved,
  setMessage,
}: {
  capabilities: PlatformCapabilities | null;
  onClose: () => void;
  onSaved: () => void;
  setMessage: (text: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("0");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amount = Number(credits);
    if (!Number.isInteger(amount) || amount < 0) {
      setMessage("初始额度必须是非负整数");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, displayName, email, credits: amount }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "创建失败");
        return;
      }
      setMessage(`用户 ${username} 已创建`);
      onSaved();
    } catch {
      setMessage("创建失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={onClose}>
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa] shadow-[0_24px_80px_rgba(50,45,40,.25)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
          <b>新建本地用户</b>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">关闭</button>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm">
          <label className="block font-semibold">用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">显示名称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">邮箱
            <input value={email} onChange={(event) => setEmail(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          <label className="block font-semibold">初始{creditLabel(capabilities)}
            <input value={credits} onChange={(event) => setCredits(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[#f5f3ed] px-5 py-3.5">
          <button type="button" onClick={onClose} className="h-9 rounded border border-[var(--line)] bg-white px-4 text-sm font-semibold">取消</button>
          <button type="button" disabled={saving} onClick={save} className="flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
            <Save size={15} />{saving ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditUserDialog({
  user,
  quotaPerUnit,
  capabilities,
  onClose,
  onSaved,
  setMessage,
}: {
  user: AdminUser;
  quotaPerUnit: number;
  capabilities: PlatformCapabilities | null;
  onClose: () => void;
  onSaved: () => void;
  setMessage: (text: string) => void;
}) {
  const localAuth = capabilities?.auth.provider === "local";
  const showUpstream = capabilities?.wallet.upstreamBalance !== false;
  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [password, setPassword] = useState("");
  const [remark, setRemark] = useState(user.remark || "");
  const [group, setGroup] = useState(user.group || "default");
  const [role, setRole] = useState(String(user.role ?? 1));
  const [status, setStatus] = useState(String(user.status ?? 1));
  const [balanceUsd, setBalanceUsd] = useState(((user.quota || 0) / quotaPerUnit).toFixed(2));
  const [affDelta, setAffDelta] = useState("0");
  const [saving, setSaving] = useState(false);

  async function save() {
    const balance = Number(balanceUsd);
    const affChange = Number(affDelta);
    if (showUpstream && (!Number.isFinite(balance) || balance < 0)) {
      setMessage(`${balanceLabel(capabilities)}必须是有效的非负数字`);
      return;
    }
    if (!Number.isFinite(affChange) || !Number.isInteger(affChange)) {
      setMessage(`${creditLabel(capabilities)}调整必须是整数`);
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
          ...(showUpstream ? { balanceUsd: balance } : {}),
          affDelta: affChange,
          ...(localAuth ? { role: Number(role), status: Number(status) } : {}),
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
            <input value={group} onChange={(event) => setGroup(event.target.value)} placeholder="default / vip …" className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          {localAuth && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block font-semibold">角色
                <select 
                  value={role} 
                  onChange={(e) => setRole(e.target.value)}
                  className="field mt-1.5 h-10 w-full px-3 text-sm"
                >
                  <option value="1">用户</option>
                  <option value="10">管理员</option>
                  <option value="100">Root</option>
                </select>
              </label>
              <label className="block font-semibold">状态
                <select 
                  value={status} 
                  onChange={(e) => setStatus(e.target.value)}
                  className="field mt-1.5 h-10 w-full px-3 text-sm"
                >
                  <option value="1">正常</option>
                  <option value="0">停用</option>
                </select>
              </label>
            </div>
          )}
          {showUpstream && (
            <label className="block font-semibold">{balanceLabel(capabilities)}（USD）
              <input value={balanceUsd} onChange={(event) => setBalanceUsd(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
            </label>
          )}
          <label className="block font-semibold">{creditLabel(capabilities)}调整（正数发放 / 负数回收，当前 {user.aff?.balance ?? "-"}）
            <input value={affDelta} onChange={(event) => setAffDelta(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
          </label>
          {!localAuth && (
            <label className="block font-semibold">备注
              <textarea value={remark} onChange={(event) => setRemark(event.target.value)} rows={3} className="field mt-1.5 w-full p-3 text-sm" placeholder="管理员备注" />
            </label>
          )}
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

function CreditsPanel({
  capabilities,
  setMessage,
}: {
  capabilities: PlatformCapabilities | null;
  setMessage: (text: string) => void;
}) {
  const [items, setItems] = useState<CreditRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [detail, setDetail] = useState<CreditDetail | null>(null);
  const [personalDelta, setPersonalDelta] = useState("0");
  const [packageDelta, setPackageDelta] = useState("0");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (search: string) => {
    try {
      const query = search ? `?keyword=${encodeURIComponent(search)}` : "";
      const response = await fetch(`/api/admin/credits${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "账本读取失败");
        return;
      }
      setItems(result.items || []);
    } catch {
      setMessage("账本读取失败");
    }
  }, [setMessage]);

  useEffect(() => {
    void Promise.resolve().then(() => load(""));
  }, [load]);

  async function openLedger(userId: number) {
    const response = await fetch(`/api/admin/credits?userId=${userId}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.message || "账本读取失败");
      return;
    }
    setDetail(result.item);
    setPersonalDelta("0");
    setPackageDelta("0");
    setNote("");
  }

  async function adjust() {
    if (!detail) return;
    const personal = Number(personalDelta);
    const pack = Number(packageDelta);
    if (!Number.isInteger(personal) || !Number.isInteger(pack)) {
      setMessage("调整金额必须是整数");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/credits/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: detail.userId,
          personalDelta: personal,
          packageDelta: pack,
          description: note,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "调整失败");
        return;
      }
      setDetail({
        ...result.item,
        username: detail.username,
        displayName: detail.displayName,
      });
      setMessage(`用户 ${detail.userId} 额度已更新`);
      load(keyword);
    } catch {
      setMessage("调整失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") load(keyword);
          }}
          placeholder="按用户 ID 筛选…"
          className="field h-9 w-full px-3 text-sm sm:w-64"
        />
        <button type="button" onClick={() => load(keyword)} className="h-9 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold hover:border-[var(--rose)]">
          筛选
        </button>
        <span className="ml-auto text-xs text-[var(--muted)]">共 {items.length} 本账本</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[#f5f3ed] text-left text-xs text-[var(--muted)]">
              <th className="px-3 py-2.5">用户 ID</th>
              <th className="px-3 py-2.5">{creditLabel(capabilities)}</th>
              <th className="px-3 py-2.5">{packageLabel(capabilities)}</th>
              <th className="px-3 py-2.5">合计</th>
              <th className="px-3 py-2.5">最近签到</th>
              <th className="px-3 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.userId} className="border-b border-[var(--line)] last:border-0 hover:bg-[#faf9f5]">
                <td className="px-3 py-2.5 font-mono text-xs">{item.userId}</td>
                <td className="px-3 py-2.5 tabular-nums">{item.balance}</td>
                <td className="px-3 py-2.5 tabular-nums">{item.packageBalance}</td>
                <td className="px-3 py-2.5 tabular-nums">{item.totalBalance}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--muted)]">{item.lastCheckInDay || "-"}</td>
                <td className="px-3 py-2.5">
                  <button type="button" onClick={() => openLedger(item.userId)} className="text-xs font-semibold text-[var(--rose)] hover:underline">
                    流水
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--muted)]">还没有额度账本</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {detail && (
        <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={() => setDetail(null)}>
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
              <div className="flex items-center gap-2">
                <Coins size={16} className="text-[var(--rose)]" />
                <b>用户 {detail.displayName || detail.username || detail.userId} 账本</b>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-sm text-[var(--muted)]">关闭</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <p className="text-xs text-[var(--muted)]">
                个人 {detail.balance} · 图包 {detail.packageBalance} · 合计 {detail.totalBalance}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block font-semibold">个人{creditLabel(capabilities)}调整
                  <input value={personalDelta} onChange={(event) => setPersonalDelta(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
                </label>
                <label className="block font-semibold">{packageLabel(capabilities)}调整
                  <input value={packageDelta} onChange={(event) => setPackageDelta(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
                </label>
              </div>
              <label className="block font-semibold">备注
                <input value={note} onChange={(event) => setNote(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" placeholder="可选" />
              </label>
              <button type="button" disabled={saving} onClick={adjust} className="h-9 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? "写入中…" : "写入调整"}
              </button>
              <div className="space-y-2">
                {(detail.transactions || []).map((item) => (
                  <div key={item.id} className="rounded border border-[var(--line)] bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <b className={item.amount >= 0 ? "text-[var(--mint)]" : "text-[var(--rose)]"}>
                        {item.amount >= 0 ? "+" : ""}{item.amount}
                      </b>
                      <time className="text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{item.description} · {item.type}{item.source ? ` · ${item.source}` : ""}</p>
                  </div>
                ))}
                {!detail.transactions?.length && <p className="py-6 text-center text-xs text-[var(--muted)]">暂无流水</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GalleryPanel({ setMessage }: { setMessage: (text: string) => void }) {
  const [items, setItems] = useState<GalleryAdminItem[]>([]);
  const [editing, setEditing] = useState<GalleryAdminItem | null>(null);
  const [title, setTitle] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState("general");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/gallery", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "图库读取失败");
        return;
      }
      setItems(result.items || []);
    } catch {
      setMessage("图库读取失败");
    }
  }, [setMessage]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  function open(item: GalleryAdminItem) {
    setEditing(item);
    setTitle(item.title);
    setAuthorName(item.authorName);
    setRating(item.rating);
    setTags(item.tags.join(", "));
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/gallery/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, authorName, rating, tags }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "保存失败");
        return;
      }
      setMessage("作品已更新");
      setEditing(null);
      load();
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("确定下架这件作品？图片文件会一并删除。")) return;
    const response = await fetch(`/api/admin/gallery/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.message || "删除失败");
      return;
    }
    setMessage("作品已下架");
    load();
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ImageIcon size={16} className="text-[var(--rose)]" />图库投稿（共 {items.length} 件）
      </p>
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-white px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{item.title}</p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                {item.authorName} · {item.ownerName} · {RATING_LABELS[item.rating] || item.rating} · {item.likes} 赞
              </p>
            </div>
            <div className="flex shrink-0 gap-3 text-xs font-semibold">
              <button type="button" onClick={() => open(item)} className="text-[var(--rose)] hover:underline">编辑</button>
              <button type="button" onClick={() => remove(item.id)} className="text-red-600 hover:underline">下架</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="py-10 text-center text-sm text-[var(--muted)]">暂无投稿</p>}
      </div>
      {editing && (
        <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-lg border border-[var(--line)] bg-[#fffefa]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
              <b>编辑作品</b>
              <button type="button" onClick={() => setEditing(null)} className="text-sm text-[var(--muted)]">关闭</button>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm">
              <label className="block font-semibold">标题
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
              </label>
              <label className="block font-semibold">署名
                <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
              </label>
              <label className="block font-semibold">评级
                <select 
                  value={rating} 
                  onChange={(e) => setRating(e.target.value as "general" | "r13" | "r18")}
                  className="field mt-1.5 h-10 w-full px-3 text-sm"
                >
                  <option value="general">全年龄</option>
                  <option value="r13">R13</option>
                  <option value="r18">R18</option>
                </select>
              </label>
              <label className="block font-semibold">标签（逗号分隔）
                <input value={tags} onChange={(event) => setTags(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[#f5f3ed] px-5 py-3.5">
              <button type="button" onClick={() => setEditing(null)} className="h-9 rounded border border-[var(--line)] bg-white px-4 text-sm font-semibold">取消</button>
              <button type="button" disabled={saving} onClick={save} className="h-9 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReferralsPanel() {
  const [items, setItems] = useState<ReferralRow[]>([]);
  const [reward, setReward] = useState(100);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const response = await fetch("/api/admin/referrals", { cache: "no-store" });
      const result = await response.json();
      if (cancelled || !response.ok) return;
      setItems(result.items || []);
      if (typeof result.reward === "number") setReward(result.reward);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">邀请双方各得 {reward} 创作额度。这里只查看记录，不改邀请码。</p>
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[#f5f3ed] text-left text-xs text-[var(--muted)]">
              <th className="px-3 py-2.5">邀请人</th>
              <th className="px-3 py-2.5">邀请码</th>
              <th className="px-3 py-2.5">已注册</th>
              <th className="px-3 py-2.5">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.code} className="border-b border-[var(--line)] last:border-0">
                <td className="px-3 py-2.5">{item.inviterName || item.inviterUserId}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{item.code}</td>
                <td className="px-3 py-2.5 tabular-nums">{item.invitedCount}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-sm text-[var(--muted)]">暂无邀请记录</td>
              </tr>
            )}
          </tbody>
        </table>
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

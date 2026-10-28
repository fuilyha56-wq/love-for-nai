"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ChevronDown,
  FileWarning,
  Globe2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
  ShieldAlert,
  Fingerprint,
} from "lucide-react";
import { LfnSelect } from "@/mobile/ui/lfn-select";
import { AdminButton, AdminDialog } from "./ui/admin-primitives";
import {
  RiskBadge,
  RiskIdentity,
  RiskPager,
  RiskSearch,
  riskDate,
  riskLabels,
} from "./risk-ui";
import "./risk.css";
import "@/app/admin/risk-ip-accounts.css";
import { groupIpEvidence } from "@/lib/ip-evidence-groups";

const LightRiskPanel = dynamic(() => import("./light-risk-panel"));
const RiskPolicyPanel = dynamic(() => import("./risk-policy-panel"));
const RiskRankingsPanel = dynamic(() => import("./risk-rankings-panel"));
const RiskUserActions = dynamic(() => import("./risk-user-actions"));
const RiskAccessPanel = dynamic(() => import("./risk-access-panel"));
type CaseRow = {
  caseId: string;
  userId: number;
  username?: string;
  level: string;
  score: number;
  lastSeenAt: string;
  signals: Array<{ id: string; description: string }>;
  usage?: { requests5h?: number; requests7d?: number; requests30d?: number };
  enforcement?: { blocked?: boolean };
};
type IpRow = {
  evidenceId: string;
  userId?: number;
  username?: string;
  family: string;
  requestCount: number;
  lastSeenAt: string;
  users?: Record<string, unknown>;
  geo?: {
    status?: string;
    countryName?: string;
    region?: string;
    city?: string;
    asn?: string;
    organization?: string;
    provider?: string;
  };
};
const size = 10;

export default function RiskDashboard() {
  const [view, setView] = useState("config"),
    [visited, setVisited] = useState(["config"]);
  const [accessEnabled, setAccessEnabled] = useState(true);
  const updateAccess = useCallback((enabled: boolean) => {
    setAccessEnabled(enabled);
    if (!enabled) setView(current => current === "access" ? "config" : current);
  }, []);
  const [items, setItems] = useState<CaseRow[]>([]),
    [ips, setIps] = useState<IpRow[]>([]),
    [counts, setCounts] = useState<Record<string, number>>({});
  const [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [geoBusy, setGeoBusy] = useState("");
  const [caseQuery, setCaseQuery] = useState(""),
    [level, setLevel] = useState(""),
    [casePage, setCasePage] = useState(1);
  const [ipQuery, setIpQuery] = useState(""),
    [ipFilter, setIpFilter] = useState(""),
    [ipPage, setIpPage] = useState(1);
  const [expanded, setExpanded] = useState<{
    item: CaseRow;
    kind: "mark" | "ban" | "chain";
  } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        ["cases?limit=200", "overview", "ip?limit=200"].map(
          async (endpoint) => {
            const response = await fetch(`/api/admin/risk/${endpoint}`, {
              cache: "no-store",
            });
            const body = await response.json();
            if (!response.ok)
              throw new Error(body.message || "读取风控数据失败");
            return body;
          },
        ),
      );
      setItems(results[0].items || []);
      setCounts(results[1].counts || {});
      updateAccess(results[1].accessEnabled !== false);
      setIps(results[2].items || []);
      setExpanded((current) =>
        current
          ? {
              ...current,
              item:
                (results[0].items as CaseRow[]).find(
                  (i) => i.userId === current.item.userId,
                ) || current.item,
            }
          : null,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "读取风控数据失败");
    } finally {
      setLoading(false);
    }
  }, [updateAccess]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  function navigate(id: string) {
    setView(id);
    setVisited((current) =>
      current.includes(id) ? current : [...current, id],
    );
  }
  async function queryGeo(id: string) {
    setGeoBusy(id);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/risk/ip/${id}/geo`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "归属地查询失败");
      setIps((current) =>
        current.map((ip) =>
          ip.evidenceId === id ? { ...ip, geo: body.geo } : ip,
        ),
      );
      setMessage("归属地快照已更新。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "归属地查询失败");
    } finally {
      setGeoBusy("");
    }
  }
  const cases = items
    .filter(
      (i) =>
        (!level ||
          (level === "banned" ? i.enforcement?.blocked : i.level === level)) &&
        `${i.username || ""} ${i.userId} ${i.signals.map((s) => s.description).join(" ")}`
          .toLowerCase()
          .includes(caseQuery.trim().toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const filteredIps = ips
    .filter(
      (i) =>
        (!ipFilter ||
          (ipFilter === "unqueried" ? !i.geo : i.family === ipFilter)) &&
        `${i.username || ""} ${i.userId || ""} ${Object.keys(i.users || {}).join(" ")} ${i.evidenceId} ${[i.geo?.countryName, i.geo?.region, i.geo?.city, i.geo?.organization].join(" ")}`
          .toLowerCase()
          .includes(ipQuery.trim().toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const groupedIps = groupIpEvidence(filteredIps);
  const currentCasePage = Math.min(
      casePage,
      Math.max(1, Math.ceil(cases.length / size)),
    ),
    currentIpPage = Math.min(
      ipPage,
      Math.max(1, Math.ceil(groupedIps.length / size)),
    );
  return (
    <div className="risk-workspace">
      <header className="risk-heading">
        <div>
          <div className="risk-kicker">
            <ShieldCheck size={14} />
            RISK CONTROL
          </div>
          <h2>风控管理</h2>
          <p>从策略配置到风险复核，集中管理每一次异常。</p>
        </div>
        <AdminButton loading={loading} onClick={() => void load()}>
          <RefreshCw size={14} />
          刷新数据
        </AdminButton>
      </header>
      <div className="risk-summary">
        {[
          {
            label: "风险案件",
            value: counts.cases,
            sub: `中风险 ${counts.risk || 0} · 高风险 ${counts.critical || 0}`,
            Icon: FileWarning,
          },
          {
            label: "已封禁账号",
            value: counts.banned,
            sub: "管理员已确认处置",
            Icon: ShieldAlert,
          },
          {
            label: "来源证据",
            value: counts.ipEvidence,
            sub: `重复摘要聚类 ${counts.promptClusters || 0}`,
            Icon: Fingerprint,
          },
          {
            label: "待处理退款",
            value: counts.pendingRefunds,
            sub: "按原计费记录复核",
            Icon: Activity,
          },
        ].map(({ label, value, sub, Icon }) => (
          <div className="risk-stat" key={label}>
            <span>
              <Icon size={14} />
              {label}
            </span>
            <strong>{loading && value == null ? "—" : value || 0}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <nav className="risk-tabs" role="tablist" aria-label="风控管理分区">
        {[
          { id: "config", label: "策略配置", Icon: Settings2 },
          { id: "rankings", label: "调用统计", Icon: Activity },
          { id: "cases", label: "风险案件", Icon: FileWarning },
          { id: "ips", label: "IP 证据", Icon: Globe2 },
          { id: "access", label: "高频申请", Icon: Users },
        ].filter(item => item.id !== "access" || accessEnabled).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            aria-controls={`risk-pane-${id}`}
            onClick={() => navigate(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      {message && (
        <p role="status" className="risk-message">
          {message}
        </p>
      )}
      <div
        className="risk-pane"
        id="risk-pane-config"
        hidden={view !== "config"}
      >
        <LightRiskPanel onAccessChange={updateAccess} />
        <details className="risk-legacy">
          <summary>旧版观察条例与邀请链设置</summary>
          <p className="risk-muted mt-3">
            保留历史观察参数；当前准入、计分与有期限处置由上方策略统一管理。
          </p>
          <RiskPolicyPanel />
        </details>
      </div>
      {visited.includes("rankings") && (
        <div
          className="risk-pane risk-panel risk-panel-body risk-rankings"
          id="risk-pane-rankings"
          hidden={view !== "rankings"}
        >
          <RiskRankingsPanel />
        </div>
      )}
      <section
        className="risk-pane risk-panel"
        id="risk-pane-cases"
        hidden={view !== "cases"}
      >
        <header className="risk-panel-head">
          <div>
            <h3>风险案件</h3>
            <p>按最近出现时间排列，分数仅用于辅助判断。</p>
          </div>
          <RiskBadge>{cases.length} 个案件</RiskBadge>
        </header>
        <div className="risk-toolbar">
          <RiskSearch
            value={caseQuery}
            onChange={(v) => {
              setCaseQuery(v);
              setCasePage(1);
            }}
            placeholder="搜索用户名、账号 ID 或异常信号"
          />
          <LfnSelect
            aria-label="案件风险等级"
            className="field h-9"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              setCasePage(1);
            }}
          >
            <option value="">全部风险等级</option>
            {Object.entries(riskLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </LfnSelect>
        </div>
        <div className="risk-table-wrap">
          <table className="risk-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>风险与状态</th>
                <th>调用量</th>
                <th>最近异常信号</th>
                <th>最近出现</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {cases
                .slice((currentCasePage - 1) * size, currentCasePage * size)
                .map((item) => (
                  <tr key={item.caseId}>
                    <td>
                      <RiskIdentity name={item.username} id={item.userId} />
                    </td>
                    <td>
                      <RiskBadge
                        tone={
                          item.enforcement?.blocked ||
                          ["risk", "critical", "severe", "isolated"].includes(
                            item.level,
                          )
                            ? "danger"
                            : item.level === "normal"
                              ? "neutral"
                              : "warning"
                        }
                      >
                        {riskLabels[item.level] || item.level}
                      </RiskBadge>
                      <span className="risk-subline">
                        {Number(item.score.toFixed(1))} 分 ·{" "}
                        {item.enforcement?.blocked ? "已封禁" : "未封禁"}
                      </span>
                    </td>
                    <td>
                      <span className="tabular-nums">
                        {item.usage?.requests5h ?? 0} /{" "}
                        {item.usage?.requests7d ?? 0} /{" "}
                        {item.usage?.requests30d ?? 0}
                      </span>
                      <span className="risk-subline">
                        5 小时 / 7 天 / 30 天
                      </span>
                    </td>
                    <td className="max-w-56">
                      <div className="space-y-1 text-[11px] leading-5">
                        {[...new Set(item.signals.map((s) => s.description))]
                          .slice(0, 2)
                          .map((s) => (
                            <p key={s}>{s}</p>
                          ))}
                      </div>
                    </td>
                    <td>
                      <span className="risk-muted whitespace-nowrap">
                        {riskDate(item.lastSeenAt)}
                      </span>
                    </td>
                    <td className="risk-actions">
                      <div className="risk-inline">
                        <AdminButton
                          onClick={() => setExpanded({ item, kind: "mark" })}
                        >
                          标记
                        </AdminButton>
                        <AdminButton
                          variant={
                            item.enforcement?.blocked ? "secondary" : "danger"
                          }
                          onClick={() => setExpanded({ item, kind: "ban" })}
                        >
                          {item.enforcement?.blocked ? "解封" : "封禁"}
                        </AdminButton>
                        <AdminButton
                          variant="quiet"
                          onClick={() => setExpanded({ item, kind: "chain" })}
                        >
                          邀请链
                        </AdminButton>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!cases.length && (
            <div className="risk-empty">
              {loading ? "正在读取风险案件…" : "当前筛选下没有案件"}
            </div>
          )}
        </div>
        <RiskPager
          page={currentCasePage}
          total={cases.length}
          size={size}
          onChange={setCasePage}
        />
        <div className="risk-notice m-4">
          <ShieldCheck size={15} />
          IP、重复提示词和邀请关系均为辅助证据。请结合审计记录复核后处置。
        </div>
      </section>
      <section
        className="risk-pane risk-panel"
        id="risk-pane-ips"
        hidden={view !== "ips"}
      >
        <header className="risk-panel-head">
          <div>
            <div className="risk-kicker">
              <Globe2 size={14} />
              NETWORK EVIDENCE
            </div>
            <h3>IP 来源证据</h3>
            <p>按账号归并，展开查看各个 IP 的来源、请求次数与归属地；已加载 {ips.length} 条 IP 证据。</p>
          </div>
          <RiskBadge tone="success">
            <ShieldCheck size={12} />
            原始地址已隐藏
          </RiskBadge>
        </header>
        <div className="risk-toolbar">
          <RiskSearch
            value={ipQuery}
            onChange={(v) => {
              setIpQuery(v);
              setIpPage(1);
            }}
            placeholder="搜索用户名、账号 ID、地区或证据编号"
          />
          <LfnSelect
            className="field h-9"
            aria-label="来源证据筛选"
            value={ipFilter}
            onChange={(e) => {
              setIpFilter(e.target.value);
              setIpPage(1);
            }}
          >
            <option value="">全部来源</option>
            <option value="ipv4">IPv4</option>
            <option value="ipv6">IPv6</option>
            <option value="unqueried">尚未查询归属地</option>
          </LfnSelect>
        </div>
        <div className="risk-ip-account-groups">
              {groupedIps.slice((currentIpPage - 1) * size, currentIpPage * size).map(group => (
                  <details key={group.key} className="risk-ip-account-group">
                    <summary>
                      <RiskIdentity name={group.username} id={group.userId} />
                      <div className="risk-ip-account-stats">
                        <span><strong>{group.items.length}</strong> 个 IP</span>
                        <span><strong>{group.requestCount.toLocaleString()}</strong> 次请求</span>
                      </div>
                      <time className="risk-ip-account-last-seen" dateTime={group.lastSeenAt}><span>最近活动</span><b>{riskDate(group.lastSeenAt)}</b></time>
                      <span className="risk-ip-account-toggle"><span className="risk-ip-account-expand">展开明细</span><span className="risk-ip-account-collapse">收起明细</span><ChevronDown size={16} aria-hidden="true" /></span>
                    </summary>
                    <div className="risk-table-wrap"><table className="risk-table"><thead><tr><th>IP 来源</th><th>证据与请求</th><th>归属地快照</th><th>最近出现</th><th>操作</th></tr></thead><tbody>
                      {group.items.map((item, index) => (
                  <tr key={item.evidenceId}>
                    <td>
                      <b>IP {index + 1}</b><span className="risk-subline">{item.family.toUpperCase()}</span>
                      {Object.keys(item.users || {}).length > 1 && (
                        <span className="risk-subline">
                          此来源关联 {Object.keys(item.users || {}).length}{" "}
                          个账号
                        </span>
                      )}
                    </td>
                    <td>
                      <RiskBadge>{item.family.toUpperCase()}</RiskBadge>
                      <span className="risk-subline">
                        {item.requestCount.toLocaleString()} 次请求
                      </span>
                      <span title={item.evidenceId} className="risk-subline">
                        证据 {item.evidenceId.slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <span>
                        {[
                          item.geo?.countryName,
                          item.geo?.region,
                          item.geo?.city,
                        ]
                          .filter(Boolean)
                          .join(" / ") ||
                          (item.geo?.status === "private"
                            ? "内网地址"
                            : item.geo
                              ? "暂未解析"
                              : "尚未查询")}
                      </span>
                      <span className="risk-subline">
                        {item.geo?.asn ||
                          item.geo?.organization ||
                          (item.geo?.provider
                            ? `数据源 ${item.geo.provider}`
                            : "按需查询，不自动访问外部服务")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="risk-muted">
                        {riskDate(item.lastSeenAt)}
                      </span>
                    </td>
                    <td className="risk-actions">
                      <AdminButton
                        loading={geoBusy === item.evidenceId}
                        disabled={Boolean(geoBusy)}
                        onClick={() => void queryGeo(item.evidenceId)}
                      >
                        <Globe2 size={13} />
                        {item.geo ? "更新快照" : "查询归属地"}
                      </AdminButton>
                    </td>
                  </tr>
                      ))}
                    </tbody></table></div>
                  </details>
              ))}
          {!filteredIps.length && (
            <div className="risk-empty">
              {loading ? "正在读取来源证据…" : "当前筛选下没有来源记录"}
            </div>
          )}
        </div>
        <RiskPager
          page={currentIpPage}
          total={groupedIps.length}
          size={size}
          onChange={setIpPage}
        />
        <p className="risk-muted px-5 pb-4">
          归属地用于辅助复核，不直接作为违规或中转的认定依据。
        </p>
      </section>
      {accessEnabled && visited.includes("access") && (
        <section
          className="risk-pane risk-panel risk-panel-body"
          id="risk-pane-access"
          hidden={view !== "access"}
        >
          <RiskAccessPanel />
        </section>
      )}
      {expanded && (
        <AdminDialog
          wide
          title={`${expanded.kind === "chain" ? "邀请链复核" : expanded.kind === "mark" ? "风险标记" : "账号处置"} · ${expanded.item.username || expanded.item.userId}`}
          onClose={() => setExpanded(null)}
        >
          <RiskUserActions
            key={`${expanded.item.userId}:${expanded.kind}`}
            user={expanded.item}
            initial={expanded.kind}
            onClose={() => setExpanded(null)}
            onChanged={load}
          />
        </AdminDialog>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState, useRef, type CSSProperties } from "react";
import {
  CheckCheck,
  Download,
  RotateCcw,
  Save,
  Upload,
  ShieldCheck,
  SlidersHorizontal,
  ListChecks,
  Layers,
  Users,
  History,
  Search,
} from "lucide-react";
import { AdminButton, AdminEmptyState } from "./ui/admin-primitives";
import { RiskBadge, RiskSearch, familyLabels, riskDate } from "./risk-ui";
import { LfnSwitch } from "@/app/ui/lfn-switch";
import { LfnSelect } from "@/app/ui/lfn-select";
import type {
  RiskField,
  RiskSettings,
  RiskValue,
  RiskRuleConfig,
  RiskGrade,
} from "@/lib/risk-settings";

type Payload = {
  settings: RiskSettings;
  defaults: RiskSettings;
  fields: RiskField[];
  history: string[];
  draft: { settings: RiskSettings } | null;
  readiness: Record<string, unknown>;
};
type Snapshot = {
  userId: number;
  score: number;
  grade: string;
  evidence: Array<{
    id: string;
    rule: string;
    points: number;
    at: number;
    details: Record<string, unknown>;
  }>;
  restrictions: Array<{ id: string; reason: string; expiresAt: number }>;
  grant: unknown;
  counts: unknown;
  readiness: unknown;
};
const names: Record<string, string> = {
  global: "全局与分值",
  identity: "外部凭据核验与缓存",
  grant: "每日免费网络授权",
  rate: "调用速率与资源",
  prompt: "提示词摘要",
  device: "设备关联",
  quota: "额度与基线",
  behavior: "调用时间分布",
  content: "内容拒绝与退避",
  network: "网络情报",
  capacity: "内存容量",
  audit: "诊断写入",
  trust: "高频授权",
  extensions: "扩展依赖",
};

export default function LightRiskPanel() {
  const [data, setData] = useState<Payload | null>(null),
    [settings, setSettings] = useState<RiskSettings | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [reason, setReason] = useState(""),
    [query, setQuery] = useState("");
  const [history, setHistory] = useState(""),
    [userId, setUserId] = useState(""),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [proofRule, setProofRule] = useState("R01"),
    [proofRef, setProofRef] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [tab, setTab] = useState("fields"),
    [group, setGroup] = useState("global"),
    [ruleId, setRuleId] = useState("B01"),
    [gradeId, setGradeId] = useState("normal");
  const importRef = useRef<HTMLInputElement>(null);
  const dirty = Boolean(
    data &&
    settings &&
    JSON.stringify(data.settings) !== JSON.stringify(settings),
  );
  async function load() {
    const response = await fetch("/api/admin/risk/settings", {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "策略读取失败");
    setData(result);
    setSettings(structuredClone(result.settings));
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/risk/settings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "策略读取失败");
        return result as Payload;
      })
      .then((result) => {
        setData(result);
        setSettings(structuredClone(result.settings));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, []);
  function value(key: string, next: RiskValue) {
    setSettings((s) =>
      s ? { ...s, values: { ...s.values, [key]: next } } : s,
    );
  }
  function rule(id: string, patch: Partial<RiskRuleConfig>) {
    setSettings((s) =>
      s
        ? {
            ...s,
            rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          }
        : s,
    );
  }
  function level(id: string, patch: Partial<RiskGrade>) {
    setSettings((s) =>
      s
        ? {
            ...s,
            levels: s.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)),
          }
        : s,
    );
  }
  async function save(action: string) {
    if (!data || !settings) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/risk/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          settings,
          expectedVersion: data.settings.version,
          reason,
          history,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "操作失败");
      if (result.settings) await load();
      if (action === "draft")
        setData((current) =>
          current
            ? { ...current, draft: { settings: structuredClone(settings) } }
            : current,
        );
      setMessage(
        action === "validate"
          ? "配置校验通过，尚未发布"
          : action === "draft"
            ? "草稿已保存，尚未生效"
            : "新策略已发布；既有处置不会被隐式解除",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function inspectUser() {
    try {
      const response = await fetch(
        `/api/admin/risk/users/${Number(userId)}/controls`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setSnapshot(result);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "读取失败");
    }
  }
  async function release(id: string) {
    if (!reason.trim() || !snapshot) {
      setMessage("请在底部填写解除原因");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/risk/users/${snapshot.userId}/controls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restrictionId: id, reason }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setSnapshot(result);
      setMessage("仅已选处置已解除，其余限制保持有效");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "解除失败");
    } finally {
      setBusy(false);
    }
  }
  async function confirmEvidence() {
    if (!snapshot || !confirmed || !proofRef.trim() || !reason.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/risk/users/${snapshot.userId}/controls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "confirm-evidence",
            confirmed,
            rule: proofRule,
            reference: proofRef,
            reason,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setSnapshot(result);
      setConfirmed(false);
      setProofRef("");
      setMessage("人工核验已审计；按该规则当前配置记分或执行固定期限动作");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  function restore(next: RiskSettings) {
    setSettings(structuredClone(next));
    setMessage("");
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 200000) {
      setMessage("配置文件过大，最多200KB");
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      const response = await fetch("/api/admin/risk/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", settings: parsed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "配置校验失败");
      restore({
        ...parsed,
        values: { ...data?.defaults.values, ...parsed.values },
        familyCaps: { ...data?.defaults.familyCaps, ...parsed.familyCaps },
      });
      setMessage("导入校验通过。请查看变更，再填写原因发布。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  }
  if (!data || !settings)
    return (
      <div className="risk-panel risk-panel-body" role="status">
        {message || "正在读取风控配置…"}
      </div>
    );
  const groups = [...new Set(data.fields.map((f) => f.group))];
  const changedFields = data.fields.filter(
    (f) => data.settings.values[f.key] !== settings.values[f.key],
  );
  const extraChanges = (
    ["rules", "levels", "overrides", "familyCaps"] as const
  ).filter(
    (k) => JSON.stringify(data.settings[k]) !== JSON.stringify(settings[k]),
  );
  const changeCount = changedFields.length + extraChanges.length;
  const matches = data.fields.filter(
    (f) =>
      (query.trim() || f.group === group) &&
      `${f.key} ${f.label} ${f.description} ${names[f.group]}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const selectedRule =
    settings.rules.find((r) => r.id === ruleId) || settings.rules[0];
  const selectedGrade =
    settings.levels.find((l) => l.id === gradeId) || settings.levels[0];
  const optionLabels: Record<string, string> = {
    unavailable: "暂停免费额度并返回503",
    observe: "仅观察",
    "hmac-sha256": "HMAC-SHA256（带密钥）",
    sha256: "SHA256（普通摘要）",
    disabled: "关闭",
    enforce: "执行配置动作",
    "rate-limit": "限流 · 429",
    deny: "暂停相关能力 · 403",
  };
  const numeric = (
    label: string,
    current: number,
    onChange: (v: number) => void,
    min = 0,
    max?: number,
  ) => (
    <label className="risk-input-label">
      {label}
      <input
        className="field"
        type="number"
        min={min}
        max={max}
        step={1}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
  return (
    <section
      className="risk-panel risk-config"
      aria-busy={busy}
      aria-label="可配置风控策略"
    >
      <header className="risk-panel-head">
        <div>
          <div className="risk-kicker">
            <SlidersHorizontal size={14} />
            POLICY CENTER
          </div>
          <h3>风控策略配置</h3>
          <p>检测参数、计分规则与处置等级，统一在此管理。</p>
        </div>
        <div className="risk-inline">
          <RiskBadge tone={dirty ? "warning" : "success"}>
            {dirty ? `${changeCount} 组待发布修改` : "已与生效版本同步"}
          </RiskBadge>
        </div>
      </header>
      <div className="risk-tabs" role="tablist" aria-label="策略编辑分类">
        {[
          { id: "fields", label: "检测参数", Icon: SlidersHorizontal },
          { id: "rules", label: "规则与计分", Icon: ListChecks },
          { id: "levels", label: "风险等级", Icon: Layers },
          { id: "overrides", label: "账号例外", Icon: Users },
          { id: "review", label: "账号复核", Icon: ShieldCheck },
          { id: "history", label: "发布与版本", Icon: History },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      {message && (
        <div className="risk-panel-body">
          <p role="status" className="risk-message">
            {message}
          </p>
        </div>
      )}
      <fieldset disabled={busy}>
        {tab === "fields" && (
          <>
            <div className="risk-toolbar">
              <RiskSearch
                placeholder="搜索全部配置名称、字段或说明"
                value={query}
                onChange={setQuery}
              />
              <RiskBadge>{data.fields.length} 项参数</RiskBadge>
            </div>
            <div className="risk-editor">
              <nav className="risk-category" aria-label="检测参数分组">
                {groups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={!query && group === g}
                    onClick={() => {
                      setGroup(g);
                      setQuery("");
                    }}
                  >
                    <span>{names[g] || g}</span>
                    <small>
                      {data.fields.filter((f) => f.group === g).length}
                    </small>
                  </button>
                ))}
              </nav>
              <div className="risk-panel-body">
                <h4 className="risk-section-title">
                  {query ? "全部配置搜索结果" : names[group]}
                </h4>
                <p className="risk-section-copy">
                  {query
                    ? `找到 ${matches.length} 项匹配配置`
                    : "修改后先校验，再填写原因发布；保存草稿不会影响当前请求。"}
                </p>
                <div className="risk-field-grid">
                  {matches.map((f) => (
                    <div
                      key={f.key}
                      className={`risk-field ${data.settings.values[f.key] !== settings.values[f.key] ? "is-changed" : ""}`}
                    >
                      {typeof f.value === "boolean" ? (
                        <LfnSwitch
                          checked={settings.values[f.key] === true}
                          label={f.label}
                          disabled={f.description.includes("未接入")}
                          onChange={(v) => value(f.key, v)}
                        />
                      ) : (
                        <label>
                          {f.label}
                          {f.options ? (
                            <LfnSelect
                              aria-label={f.label}
                              className="field"
                              value={String(settings.values[f.key])}
                              onChange={(e) => value(f.key, e.target.value)}
                            >
                              {f.options.map((v) => (
                                <option key={v} value={v}>
                                  {optionLabels[v] || v}
                                </option>
                              ))}
                            </LfnSelect>
                          ) : (
                            <input
                              className="field"
                              type={
                                typeof f.value === "number" ? "number" : "text"
                              }
                              min={f.min}
                              max={f.max}
                              step={1}
                              value={String(settings.values[f.key])}
                              onChange={(e) =>
                                value(
                                  f.key,
                                  typeof f.value === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                                )
                              }
                            />
                          )}
                        </label>
                      )}
                      {f.description && <p>{f.description}</p>}
                      <details>
                        <summary>默认值与字段说明</summary>
                        <p>
                          {f.key}
                          <br />
                          默认：{String(f.value)}
                          {f.min != null ? ` · 可设范围 ${f.min}–${f.max}` : ""}
                        </p>
                        <button
                          type="button"
                          className="text-[var(--rose)]"
                          onClick={() => value(f.key, f.value)}
                        >
                          恢复此项默认值
                        </button>
                      </details>
                    </div>
                  ))}
                </div>
                {!matches.length && (
                  <AdminEmptyState>
                    未找到配置，试试“额度”“设备”或“限流”。
                  </AdminEmptyState>
                )}
              </div>
            </div>
          </>
        )}
        {tab === "rules" && (
          <div className="risk-editor">
            <nav className="risk-category risk-rule-list" aria-label="风控规则">
              {settings.rules.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={selectedRule.id === r.id}
                  onClick={() => setRuleId(r.id)}
                >
                  <span>
                    {r.id} · {r.label}
                  </span>
                  <small>
                    {r.mode === "disabled"
                      ? "已关闭"
                      : r.mode === "observe"
                        ? "观察"
                        : "执行"}{" "}
                    · +{r.points} 分
                  </small>
                </button>
              ))}
            </nav>
            <div className="risk-panel-body">
              <div className="risk-inline">
                <h4 className="risk-section-title">
                  {selectedRule.id} · {selectedRule.label}
                </h4>
                <RiskBadge tone={selectedRule.strong ? "warning" : "neutral"}>
                  {selectedRule.strong ? "明确证据" : "辅助观察"}
                </RiskBadge>
              </div>
              <p className="risk-section-copy">
                {selectedRule.strong
                  ? "依照本规则的模式、动作与期限执行。"
                  : "此类证据用于辅助观察，增加分数不会将它变成强证据。"}
              </p>
              <div className="risk-field-grid">
                <label className="risk-input-label">
                  规则名称
                  <input
                    className="field"
                    maxLength={80}
                    value={selectedRule.label}
                    onChange={(e) =>
                      rule(selectedRule.id, { label: e.target.value })
                    }
                  />
                </label>
                <label className="risk-input-label">
                  运行模式
                  <LfnSelect
                    aria-label="规则运行模式"
                    className="field"
                    value={selectedRule.mode}
                    onChange={(e) =>
                      rule(selectedRule.id, {
                        mode: e.target.value as RiskRuleConfig["mode"],
                      })
                    }
                  >
                    {["disabled", "observe", "enforce"].map((m) => (
                      <option key={m} value={m}>
                        {optionLabels[m]}
                      </option>
                    ))}
                  </LfnSelect>
                </label>
                {(
                  [
                    ["points", "单次增加分值"],
                    ["maxPoints", "窗口贡献上限"],
                    ["cooldownSeconds", "加分冷却（秒）"],
                    ["expiresSeconds", "证据有效期（秒）"],
                    ["durationSeconds", "处置持续时间（秒）"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    {numeric(label, selectedRule[key], (v) =>
                      rule(selectedRule.id, { [key]: v }),
                    )}
                  </div>
                ))}
                <label className="risk-input-label">
                  命中后动作
                  <LfnSelect
                    aria-label="规则命中后动作"
                    disabled={!selectedRule.strong}
                    className="field"
                    value={selectedRule.action}
                    onChange={(e) =>
                      rule(selectedRule.id, {
                        action: e.target.value as RiskRuleConfig["action"],
                      })
                    }
                  >
                    {["observe", "rate-limit", "deny"].map((m) => (
                      <option key={m} value={m}>
                        {optionLabels[m]}
                      </option>
                    ))}
                  </LfnSelect>
                </label>
              </div>
              <details className="risk-toolbox mt-5">
                <summary>证据类别的总贡献上限</summary>
                <div className="risk-field-grid mt-4">
                  {Object.entries(settings.familyCaps).map(([family, cap]) => (
                    <div key={family}>
                      {numeric(familyLabels[family] || family, cap, (v) =>
                        setSettings({
                          ...settings,
                          familyCaps: { ...settings.familyCaps, [family]: v },
                        }),
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}
        {tab === "levels" && (
          <div className="risk-panel-body">
            <h4 className="risk-section-title">七级风险分层</h4>
            <p className="risk-section-copy">
              点击等级编辑。分数线需从低到高递增；等级自动动作由“全局与分值”中的开关控制。
            </p>
            <div className="risk-grade-list">
              {settings.levels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="risk-grade"
                  style={{ "--grade-color": l.color } as CSSProperties}
                  aria-pressed={selectedGrade.id === l.id}
                  onClick={() => setGradeId(l.id)}
                >
                  {l.name}
                  <small>≥ {l.minimum} 分</small>
                </button>
              ))}
            </div>
            <div className="risk-field-grid">
              <label className="risk-input-label">
                等级名称
                <input
                  className="field"
                  maxLength={30}
                  value={selectedGrade.name}
                  onChange={(e) =>
                    level(selectedGrade.id, { name: e.target.value })
                  }
                />
              </label>
              {numeric("最低风险分数", selectedGrade.minimum, (v) =>
                level(selectedGrade.id, { minimum: v }),
              )}
              <label className="risk-input-label">
                显示颜色
                <input
                  type="color"
                  className="field"
                  value={selectedGrade.color}
                  onChange={(e) =>
                    level(selectedGrade.id, { color: e.target.value })
                  }
                />
              </label>
              <label className="risk-input-label">
                等级动作
                <LfnSelect
                  aria-label="等级动作"
                  className="field"
                  value={selectedGrade.action}
                  onChange={(e) =>
                    level(selectedGrade.id, {
                      action: e.target.value as RiskGrade["action"],
                    })
                  }
                >
                  {["observe", "rate-limit", "deny"].map((m) => (
                    <option key={m} value={m}>
                      {optionLabels[m]}
                    </option>
                  ))}
                </LfnSelect>
              </label>
              {numeric(
                "处置持续时间（秒）",
                selectedGrade.durationSeconds,
                (v) => level(selectedGrade.id, { durationSeconds: v }),
              )}
            </div>
            <div className="risk-notice mt-5">
              等级自动动作仍需满足独立强证据条件；修改分数不会自动认定违规。
            </div>
          </div>
        )}
        {tab === "overrides" && (
          <div className="risk-panel-body">
            <div className="risk-heading">
              <div>
                <h4 className="risk-section-title">限时账号例外</h4>
                <p className="risk-section-copy">
                  仅覆盖调用速率、并发和网络换绑参数。每个账号保留一项例外。
                </p>
              </div>
              <AdminButton
                onClick={() =>
                  setSettings({
                    ...settings,
                    overrides: [
                      ...settings.overrides,
                      { userId: 0, expiresAt: "", reason: "", values: {} },
                    ],
                  })
                }
              >
                添加账号
              </AdminButton>
            </div>
            {!settings.overrides.length && (
              <AdminEmptyState>
                当前没有账号例外。用户提交的高频申请在“高频申请”中审批。
              </AdminEmptyState>
            )}
            <div className="risk-overrides">
              {settings.overrides.map((o, i) => {
                const patch = (v: Partial<typeof o>) =>
                  setSettings({
                    ...settings,
                    overrides: settings.overrides.map((current, j) =>
                      j === i ? { ...current, ...v } : current,
                    ),
                  });
                return (
                  <div key={i} className="risk-override">
                    <div className="risk-override-head">
                      <RiskBadge>账号例外 {i + 1}</RiskBadge>
                      <AdminButton
                        variant="quiet"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            overrides: settings.overrides.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        移除此项
                      </AdminButton>
                    </div>
                    <div className="risk-field-grid">
                      {numeric(
                        "账号ID",
                        o.userId,
                        (v) => patch({ userId: v }),
                        1,
                      )}
                      <label className="risk-input-label">
                        到期时间（本地时区）
                        <input
                          className="field"
                          type="datetime-local"
                          value={
                            o.expiresAt &&
                            Number.isFinite(Date.parse(o.expiresAt))
                              ? new Date(
                                  Date.parse(o.expiresAt) -
                                    new Date(o.expiresAt).getTimezoneOffset() *
                                      60000,
                                )
                                  .toISOString()
                                  .slice(0, 16)
                              : ""
                          }
                          onChange={(e) =>
                            patch({
                              expiresAt: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : "",
                            })
                          }
                        />
                      </label>
                      <label className="risk-input-label">
                        例外原因
                        <input
                          className="field"
                          value={o.reason}
                          onChange={(e) => patch({ reason: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="risk-field-grid mt-4">
                      {[
                        "rate.perMinute",
                        "rate.burst",
                        "rate.maxInFlight",
                        "grant.maxRebinds",
                        "grant.minRebindSeconds",
                      ].map((k) => (
                        <label key={k} className="risk-input-label">
                          {data.fields.find((f) => f.key === k)?.label}
                          <input
                            className="field"
                            type="number"
                            placeholder="沿用全局配置"
                            value={
                              o.values[k] === undefined
                                ? ""
                                : String(o.values[k])
                            }
                            onChange={(e) => {
                              const values = { ...o.values };
                              if (e.target.value === "") delete values[k];
                              else values[k] = Number(e.target.value);
                              patch({ values });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab === "review" && (
          <div className="risk-panel-body">
            <h4 className="risk-section-title">账号证据与处置复核</h4>
            <p className="risk-section-copy">
              查看免费网络授权与当前限制，按具体证据复核。解除操作使用底部填写的原因。
            </p>
            <div className="risk-inline">
              <input
                aria-label="复核账号ID"
                className="field max-w-52"
                type="number"
                min={1}
                placeholder="输入账号 ID"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
              <AdminButton
                disabled={!Number(userId)}
                onClick={() => void inspectUser()}
              >
                <Search size={14} />
                读取账号
              </AdminButton>
            </div>
            {snapshot && (
              <>
                <div className="risk-inline my-5">
                  <RiskBadge>账号 {snapshot.userId}</RiskBadge>
                  <RiskBadge>{snapshot.grade}</RiskBadge>
                  <strong>{snapshot.score.toFixed(1)} 分</strong>
                </div>
                {snapshot.restrictions.map((r) => (
                  <div key={r.id} className="risk-change risk-heading">
                    <div>
                      {r.reason}
                      <small>到期 {riskDate(r.expiresAt)}</small>
                    </div>
                    <AdminButton
                      disabled={busy}
                      onClick={() => void release(r.id)}
                    >
                      解除此项
                    </AdminButton>
                  </div>
                ))}
                {!snapshot.restrictions.length && (
                  <p className="risk-muted">当前没有有效限制。</p>
                )}
                <details className="risk-toolbox my-4">
                  <summary>授权、计数和当前证据详情</summary>
                  <pre className="max-h-80 overflow-auto text-xs mt-3">
                    {JSON.stringify(
                      {
                        counts: snapshot.counts,
                        grant: snapshot.grant,
                        evidence: snapshot.evidence,
                        readiness: snapshot.readiness,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <details className="risk-toolbox">
                  <summary>人工核验明确事实</summary>
                  <p className="risk-section-copy mt-3">
                    请在独立案件记录中保留依据，仅填内部证据编号。不能仅凭IP、VPN或提示词相同认定违规。
                  </p>
                  <LfnSelect
                    aria-label="人工核验证据类型"
                    className="field"
                    value={proofRule}
                    onChange={(e) => setProofRule(e.target.value)}
                  >
                    <option value="N05">N05 · 已确认恶意网络活动</option>
                    <option value="R01">R01 · 已确认规避平台限制</option>
                    <option value="G01">G01 · 已确认协同奖励套利</option>
                  </LfnSelect>
                  <input
                    className="field my-3"
                    value={proofRef}
                    onChange={(e) => setProofRef(e.target.value)}
                    maxLength={200}
                    placeholder="内部证据编号"
                  />
                  <LfnSwitch
                    checked={confirmed}
                    onChange={setConfirmed}
                    label={`已独立核验账号 ${snapshot.userId} 的事实与操作原因`}
                  />
                  <AdminButton
                    className="mt-3"
                    disabled={!confirmed || !proofRef.trim() || !reason.trim()}
                    onClick={() => void confirmEvidence()}
                  >
                    记录核验结果
                  </AdminButton>
                </details>
              </>
            )}
          </div>
        )}
        {tab === "history" && (
          <div className="risk-panel-body">
            <h4 className="risk-section-title">发布与版本管理</h4>
            <p className="risk-section-copy">
              生效版本：{data.settings.version}
              。操作均保留审核记录，回滚不会解除已有处置。
            </p>
            <div className="risk-checks">
              {[
                ["设备摘要", data.readiness.deviceSecret],
                ["可信代理", data.readiness.trustedIp],
                ["语义模型", data.readiness.semantic],
                ["外部信誉", data.readiness.externalReputation],
                ["人机验证", data.readiness.captcha],
              ].map(([label, enabled]) => (
                <RiskBadge
                  key={String(label)}
                  tone={enabled ? "success" : "neutral"}
                >
                  {String(label)} · {enabled ? "已就绪" : "未接入/未启用"}
                </RiskBadge>
              ))}
            </div>
            <h4 className="risk-section-title mt-6">
              待发布差异 · {changeCount} 组
            </h4>
            {!dirty && (
              <p className="risk-muted">当前编辑内容与线上生效版本一致。</p>
            )}
            {changedFields.map((f) => (
              <div key={f.key} className="risk-change">
                {f.label}
                <small>
                  {String(data.settings.values[f.key])} →{" "}
                  {String(settings.values[f.key])}
                </small>
              </div>
            ))}
            {extraChanges.map((k) => (
              <details className="risk-change" key={k}>
                <summary className="cursor-pointer">
                  {
                    {
                      rules: "规则与计分",
                      levels: "风险等级",
                      overrides: "账号例外",
                      familyCaps: "证据类别上限",
                    }[k]
                  }
                  有修改
                </summary>
                <pre className="max-h-64 overflow-auto text-xs mt-3">
                  {JSON.stringify(
                    { before: data.settings[k], after: settings[k] },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
            <h4 className="risk-section-title mt-6">历史回滚</h4>
            <div className="risk-inline">
              <LfnSelect
                aria-label="历史变更记录"
                className="field flex-1"
                value={history}
                onChange={(e) => setHistory(e.target.value)}
              >
                <option value="">选择历史变更记录</option>
                {data.history.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </LfnSelect>
              <AdminButton
                disabled={!history || !reason.trim()}
                onClick={() => void save("rollback")}
              >
                <RotateCcw size={14} />
                回滚至变更前
              </AdminButton>
            </div>
            <p className="risk-muted mt-3">
              回滚需要填写底部操作原因；未发布内容请先保存为草稿。
            </p>
          </div>
        )}
      </fieldset>
      <details className="risk-toolbox">
        <summary>草稿、导入导出与默认值</summary>
        <div className="risk-inline">
          <AdminButton
            disabled={busy || !data.draft}
            onClick={() => data.draft && restore(data.draft.settings)}
          >
            加载已存草稿
          </AdminButton>
          <AdminButton disabled={busy} onClick={() => restore(data.defaults)}>
            预览默认配置
          </AdminButton>
          <AdminButton
            disabled={busy}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(settings, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "lfn-risk-policy.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} />
            导出配置
          </AdminButton>
          <AdminButton
            disabled={busy}
            onClick={() => importRef.current?.click()}
          >
            <Upload size={14} />
            导入并校验
          </AdminButton>
          <input
            ref={importRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </div>
      </details>
      <footer className="risk-savebar">
        <label>
          <input
            className="field"
            aria-label="操作原因"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="填写发布、回滚或复核的具体原因"
          />
        </label>
        <div className="risk-inline">
          <AdminButton
            variant="quiet"
            disabled={busy || !dirty}
            aria-label="撤销未发布修改"
            onClick={() => restore(data.settings)}
          >
            <RotateCcw size={14} />
          </AdminButton>
          <AdminButton disabled={busy} onClick={() => void save("validate")}>
            <CheckCheck size={14} />
            校验
          </AdminButton>
          <AdminButton disabled={busy} onClick={() => void save("draft")}>
            <Save size={14} />
            存草稿
          </AdminButton>
          <AdminButton
            variant="primary"
            loading={busy}
            disabled={!dirty || !reason.trim()}
            onClick={() => void save("publish")}
          >
            发布策略
          </AdminButton>
        </div>
      </footer>
    </section>
  );
}

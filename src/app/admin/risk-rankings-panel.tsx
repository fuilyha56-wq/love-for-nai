"use client";
import { LfnSelect } from "@/app/ui/lfn-select";

import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Clock3,
  Download,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import type { EChartsOption } from "echarts";
import type { RequestRankings } from "@/lib/request-audit";
import { RiskIdentity } from "./risk-ui";

type View = "users" | "times" | "models";
const numberFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});
const palette = [
  "#d15b73",
  "#368677",
  "#517eaf",
  "#b48b38",
  "#8a68a0",
  "#649547",
  "#c67545",
  "#74818f",
  "#ac607e",
];

function RankingChart({
  data,
  view,
  limit,
}: {
  data: RequestRankings;
  view: View;
  limit: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    void import("./risk-chart-runtime").then((echarts) => {
      if (cancelled || !container.current) return;
      const chart = echarts.init(container.current);
      const metric = data.metric;
      const timeline = view === "times";
      const names = data.models.slice(0, 8).map((item) => item.name);
      const values =
        view === "users"
          ? data.users.slice(0, limit)
          : data.models.slice(0, limit);
      const labels = timeline
        ? data.times.map((item) => item.label)
        : values.map((item) =>
            "username" in item
              ? `${item.username} #${item.userId || "?"}`
              : item.name,
          );
      const series: EChartsOption["series"] =
        view === "users"
          ? [...names, "其他模型"].map((name) => ({
              name,
              type: "bar",
              stack: "total",
              barMaxWidth: 24,
              data: data.users
                .slice(0, limit)
                .map((user) =>
                  name === "其他模型"
                    ? Object.entries(user.breakdown).reduce(
                        (sum, [model, value]) =>
                          sum + (names.includes(model) ? 0 : value[metric]),
                        0,
                      )
                    : user.breakdown[name]?.[metric] || 0,
                ),
            }))
          : timeline
            ? [...names, "其他模型"].map((name) => ({
                name,
                type: "bar",
                stack: "total",
                barMaxWidth: 32,
                data: data.times.map((item) =>
                  name === "其他模型"
                    ? Object.entries(item.breakdown).reduce(
                        (sum, [model, value]) =>
                          sum + (names.includes(model) ? 0 : value[metric]),
                        0,
                      )
                    : item.breakdown[name]?.[metric] || 0,
                ),
              }))
            : [
                {
                  name: metric === "anlas" ? "Anlas" : "调用量",
                  type: "bar",
                  barMaxWidth: 24,
                  data: values.map((item) => item[metric]),
                  itemStyle: { color: palette[1] },
                },
              ];
      chart.setOption({
        color: palette,
        animationDuration: 250,
        textStyle: { fontFamily: "inherit", fontSize: 11 },
        tooltip: {
          trigger: "axis",
          confine: true,
          renderMode: "richText",
          axisPointer: { type: "shadow" },
          valueFormatter: (value: number | string) =>
            numberFormat.format(Number(value)),
        },
        legend:
          view !== "models"
            ? { type: "scroll", top: 0, left: 0, right: 0 }
            : { show: false },
        grid: {
          top: view !== "models" ? 50 : 12,
          left: timeline ? 8 : 4,
          right: 18,
          bottom: timeline ? 65 : 12,
          containLabel: true,
        },
        xAxis: timeline
          ? { type: "category", data: labels, axisLabel: { hideOverlap: true } }
          : { type: "value", minInterval: metric === "calls" ? 1 : undefined },
        yAxis: timeline
          ? { type: "value", minInterval: metric === "calls" ? 1 : undefined }
          : {
              type: "category",
              data: labels,
              inverse: true,
              axisLabel: { width: 125, overflow: "truncate" },
            },
        dataZoom: timeline
          ? [{ type: "slider", bottom: 4, height: 22 }, { type: "inside" }]
          : [],
        series,
      });
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(container.current);
      cleanup = () => {
        observer.disconnect();
        chart.dispose();
      };
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [data, view, limit]);
  return (
    <div
      ref={container}
      role="img"
      aria-label={`${view === "times" ? "调用时间堆叠图" : view === "users" ? "用户排行图" : "模型调用排行图"}，按${data.metric === "calls" ? "调用量" : "Anlas"}`}
      className="w-full min-w-0"
      style={{
        height:
          view === "times"
            ? 350
            : Math.min(
                560,
                Math.max(
                  240,
                  Math.min(
                    limit,
                    view === "users" ? data.users.length : data.models.length,
                  ) *
                    30 +
                    40,
                ),
              ),
      }}
    />
  );
}

export default function RiskRankingsPanel() {
  const [data, setData] = useState<RequestRankings | null>(null);
  const [metric, setMetric] = useState<"calls" | "anlas">("calls");
  const [view, setView] = useState<View>("users");
  const [days, setDays] = useState(1);
  const [source, setSource] = useState("");
  const [bucket, setBucket] = useState("hour");
  const [keyword, setKeyword] = useState("");
  const [userId, setUserId] = useState<number>();
  const [limit, setLimit] = useState(10);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          days: String(days),
          metric,
          source,
          keyword,
          bucket,
        });
        if (userId) params.set("userId", String(userId));
        const response = await fetch(`/api/admin/risk/rankings?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "调用排行读取失败");
        if (!controller.signal.aborted) setData(result);
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : "调用排行读取失败",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [days, metric, source, keyword, bucket, userId, revision]);
  const times = data
    ? [...data.times]
        .filter((item) => item.calls > 0)
        .sort(
          (left, right) =>
            right[data.metric] - left[data.metric] || right.calls - left.calls,
        )
        .slice(0, limit)
    : [];
  const format = (value: number) => numberFormat.format(value);
  function consumption(item: {
    calls: number;
    anlas: number;
    anlasRecords: number;
    estimatedAnlas: number;
    unreportedRecords: number;
  }) {
    const estimatedRecords =
      item.calls - item.anlasRecords - item.unreportedRecords;
    return (
      <>
        <span>{format(item.anlas)}</span>
        <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">
          {item.anlasRecords} 次有返回
          {estimatedRecords > 0
            ? ` · ${estimatedRecords} 次估算 ${format(item.estimatedAnlas)}`
            : ""}
          {item.unreportedRecords > 0
            ? ` · ${item.unreportedRecords} 次未提供消耗记录`
            : ""}
        </span>
      </>
    );
  }
  function exportCsv() {
    if (!data) return;
    const rows =
      view === "users"
        ? data.users.map((item) => [
            item.userId || "",
            item.username,
            item.calls,
            item.anlas,
            item.estimatedAnlas,
            item.unreportedRecords,
            Object.entries(item.breakdown)
              .map(([model, value]) => `${model}: ${value.calls}次`)
              .join("; "),
            item.lastAt,
          ])
        : view === "models"
          ? data.models.map((item) => [
              item.name,
              item.calls,
              item.anlas,
              item.estimatedAnlas,
              item.unreportedRecords,
              item.anlasRecords,
            ])
          : data.times.map((item) => [
              item.bucket,
              item.label,
              item.users?.map((u) => u.username).join("; ") || "",
              item.calls,
              item.anlas,
            ]);
    const header =
      view === "users"
        ? [
            "用户ID",
            "用户名",
            "调用量",
            "返回Anlas",
            "公式估算Anlas",
            "未提供消耗记录",
            "模型调用明细",
            "最近调用",
          ]
        : view === "models"
          ? [
              "模型",
              "调用量",
              "返回Anlas",
              "公式估算Anlas",
              "未提供消耗记录",
              "Anlas记录数",
            ]
          : ["时间UTC", "时间上海", "主要调用用户", "调用量", "返回Anlas"];
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `lfn-${view}-${days}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="min-w-0 border-t border-[var(--line)] pt-5"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">调用记录排行</h2>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="排行指标"
            className="flex rounded border border-[var(--line)] p-0.5"
          >
            {(["calls", "anlas"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={metric === value}
                onClick={() => setMetric(value)}
                className={`rounded px-3 py-1.5 text-xs font-semibold ${metric === value ? "bg-[var(--rose)] text-white" : "text-[var(--muted)]"}`}
              >
                {value === "calls" ? "调用量" : "消耗 Anlas"}
              </button>
            ))}
          </div>
          <button
            type="button"
            title="刷新排行"
            aria-label="刷新排行"
            onClick={() => setRevision((value) => value + 1)}
            className="grid h-9 w-9 place-items-center rounded border border-[var(--line)]"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            title="导出当前排行"
            aria-label="导出当前排行"
            disabled={!data || loading}
            onClick={exportCsv}
            className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] disabled:opacity-40"
          >
            <Download size={15} />
          </button>
        </div>
      </div>
      <div className="risk-rank-filters">
        <label className="relative min-w-40 flex-1">
          <Search
            size={14}
            className="absolute left-2.5 top-3 text-[var(--muted)]"
          />
          <input
            aria-label="搜索用户名、用户 ID 或模型"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="用户名、用户 ID、模型"
            className="field h-9 w-full pl-8 pr-3 text-xs"
          />
        </label>
        <LfnSelect
          aria-label="统计时间范围"
          value={days}
          onChange={(event) => {
            const value = Number(event.target.value);
            setDays(value);
            setBucket(value > 7 ? "day" : "hour");
          }}
          className="field h-9 px-2 text-xs"
        >
          <option value={1}>最近 24 小时</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
        </LfnSelect>
        <LfnSelect
          aria-label="调用来源"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="field h-9 px-2 text-xs"
        >
          <option value="">所有来源</option>
          <option value="lfn">内部工作台</option>
          <option value="api">外部 API</option>
        </LfnSelect>
        <LfnSelect
          aria-label="时间聚合粒度"
          value={bucket}
          onChange={(event) => setBucket(event.target.value)}
          className="field h-9 px-2 text-xs"
        >
          <option value="hour">按小时</option>
          <option value="day">按天</option>
        </LfnSelect>
        <LfnSelect
          aria-label="排行显示数量"
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
          className="field h-9 px-2 text-xs"
        >
          <option value={10}>前 10</option>
          <option value={25}>前 25</option>
          <option value={50}>前 50</option>
        </LfnSelect>
        {userId && (
          <button
            type="button"
            onClick={() => setUserId(undefined)}
            className="inline-flex items-center gap-1 text-xs text-[var(--rose)]"
          >
            用户 #{userId}
            <X size={14} />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {data && !error && (
        <>
          <div className="my-4 grid grid-cols-2 gap-3 border-y border-[var(--line)] py-3 sm:grid-cols-4">
            {[
              ["统计调用", format(data.totalCalls)],
              ["调用用户", format(data.totalUsers)],
              ["已确认 Anlas", format(data.totalAnlas)],
              ["Anlas 覆盖", `${data.anlasRecords} / ${data.totalCalls}`],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] text-[var(--muted)]">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div
            role="tablist"
            aria-label="调用排行视图"
            className="flex gap-1 border-b border-[var(--line)]"
          >
            {(
              [
                { value: "users", title: "用户排行", Icon: Users },
                { value: "times", title: "调用时间", Icon: Clock3 },
                { value: "models", title: "模型调用量", Icon: BarChart3 },
              ] as const
            ).map(({ value, title, Icon }) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === value}
                key={value}
                onClick={() => setView(value)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold ${view === value ? "border-[var(--rose)] text-[var(--rose)]" : "border-transparent text-[var(--muted)]"}`}
              >
                <Icon size={14} />
                {title}
              </button>
            ))}
          </div>
          <div className={`py-4 ${loading ? "opacity-50" : ""}`}>
            {data.totalCalls ? (
              <RankingChart data={data} view={view} limit={limit} />
            ) : (
              <p className="grid min-h-52 place-items-center text-sm text-[var(--muted)]">
                当前筛选条件下暂无调用记录
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="risk-table risk-rank-table">
              <thead className="border-y border-[var(--line)] bg-white/60 text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2">
                    {view === "users"
                      ? "用户"
                      : view === "times"
                        ? "主要调用用户 / 高峰时段"
                        : "模型 / 端点"}
                  </th>
                  <th className="px-2 py-2 text-right">调用量</th>
                  <th className="px-2 py-2 text-right">已确认 Anlas</th>
                  <th className="px-2 py-2">
                    {view === "users"
                      ? "最近调用"
                      : view === "models"
                        ? "Anlas 覆盖"
                        : "占调用量"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {view === "users" &&
                  data.users.slice(0, limit).map((item) => (
                    <tr
                      key={item.userId || "anonymous"}
                      className="border-b border-[var(--line)]"
                    >
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          disabled={!item.userId}
                          onClick={() => setUserId(item.userId)}
                          className="text-left font-semibold text-[var(--rose)]"
                        >
                          <RiskIdentity name={item.username} id={item.userId} />
                        </button>
                        <details className="mt-2 text-[10px] text-[var(--muted)]">
                          <summary className="cursor-pointer">
                            模型调用明细
                          </summary>
                          <div className="mt-2 space-y-1">
                            {Object.entries(item.breakdown).map(
                              ([model, value]) => (
                                <p
                                  key={model}
                                  className="text-[10px] text-[var(--muted)]"
                                >
                                  {model} · {value.calls} 次 ·{" "}
                                  {format(value.anlas)} Anlas
                                </p>
                              ),
                            )}
                          </div>
                        </details>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {format(item.calls)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {consumption(item)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-[var(--muted)]">
                        {new Date(item.lastAt).toLocaleString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}
                      </td>
                    </tr>
                  ))}
                {view === "times" &&
                  times.map((item) => (
                    <tr
                      key={item.bucket}
                      className="border-b border-[var(--line)]"
                    >
                      <td className="px-2 py-2.5">
                        <div className="space-y-1">
                          {item.users?.length ? (
                            item.users.map((u) => (
                              <button
                                key={u.userId || "anonymous"}
                                type="button"
                                disabled={!u.userId}
                                onClick={() => {
                                  setUserId(u.userId);
                                  setView("users");
                                }}
                                className="block text-left text-[var(--rose)]"
                              >
                                {u.username}
                                <span className="ml-2 text-[10px] text-[var(--muted)]">
                                  {u.calls} 次
                                </span>
                              </button>
                            ))
                          ) : (
                            <span className="risk-muted">未关联用户</span>
                          )}
                        </div>
                        <span className="risk-subline">
                          {item.label} · {item.userCount || 0} 位调用用户
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {format(item.calls)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {format(item.anlas)}
                      </td>
                      <td className="px-2 py-2.5 text-[var(--muted)]">
                        {((item.calls / data.totalCalls) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                {view === "models" &&
                  data.models.slice(0, limit).map((item) => (
                    <tr
                      key={item.name}
                      className="border-b border-[var(--line)]"
                    >
                      <td className="max-w-56 break-all px-2 py-2.5 font-semibold">
                        {item.name}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {format(item.calls)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {consumption(item)}
                      </td>
                      <td className="px-2 py-2.5 text-[var(--muted)]">
                        {item.anlasRecords} / {item.calls}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <details className="mt-4 text-[11px] leading-5 text-[var(--muted)]">
            <summary className="cursor-pointer">统计口径与消耗覆盖说明</summary>
            <p className="mt-2">
              调用量按请求 ID 去重，含被拒绝及失败请求；limit
              模型合并到对应普通模型。Anlas 合计只包含上游返回值；另有公式估算{" "}
              {format(data.totalEstimatedAnlas)} Anlas，{data.unreportedRecords}{" "}
              次历史请求未提供消耗记录。估算值单列，保留 30 天、最多{" "}
              {format(data.retainedLimit)} 条。
            </p>
          </details>
        </>
      )}
      {!data && !error && (
        <p
          role="status"
          className="py-12 text-center text-sm text-[var(--muted)]"
        >
          正在读取调用记录…
        </p>
      )}
    </section>
  );
}

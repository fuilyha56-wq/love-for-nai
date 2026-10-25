"use client";
import { useEffect, useState } from "react";
import { RiskIdentity, RiskPager, RiskSearch } from "./risk-ui";
export default function RiskGradeUsers({
  gradeId,
  name,
}: {
  gradeId: string;
  name: string;
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [items, setItems] = useState<
      Array<{ userId: number; username: string; score: number }>
    >([]),
    [total, setTotal] = useState(0),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        level: gradeId,
        page: String(page),
        keyword: query,
      });
      void fetch(`/api/admin/risk/level-users?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw Error(data.message || "读取等级用户失败");
          return data;
        })
        .then((data) => {
          setItems(data.items);
          setTotal(data.total);
          setMessage("");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setMessage(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [gradeId, page, query]);
  return (
    <section
      className="mt-6 border-t border-[var(--line)] pt-5"
      aria-label="当前等级用户"
    >
      <h4 className="risk-section-title">{name} · 对应用户</h4>
      <p className="risk-section-copy">
        按已发布的等级分数线展示已观测用户；未发布的编辑不影响此列表，人工封禁账号在案件页查看。
      </p>
      <RiskSearch
        value={query}
        onChange={(value) => {
          setLoading(true);
          setQuery(value);
          setPage(1);
        }}
        placeholder="搜索等级内用户名或 ID"
      />
      {message ? (
        <p role="status" className="risk-message">
          {message}
        </p>
      ) : loading ? (
        <p className="risk-muted py-4">正在读取对应用户…</p>
      ) : items.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.userId}
              className="risk-inline rounded-lg border border-[var(--line)] p-3"
            >
              <div className="min-w-0 flex-1">
                <RiskIdentity name={item.username} id={item.userId} />
              </div>
              <span>{item.score} 分</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="risk-muted py-4">当前等级没有已观测用户。</p>
      )}
      <RiskPager
        page={page}
        total={total}
        size={10}
        onChange={(value) => {
          setLoading(true);
          setPage(value);
        }}
      />
    </section>
  );
}

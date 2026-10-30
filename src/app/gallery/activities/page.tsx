"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { PublicHeader } from "@/app/public-header";
import type { CreatorRewardCampaign } from "@/lib/creator-rewards";
import type { ActivityRow } from "@/lib/activity-leaderboards";
import "./rankings.css";

type Campaign = CreatorRewardCampaign & { phase: string };
type Board = {
  id: string;
  name: string;
  rewards: number[];
  consolationReward: number;
  total: number;
  pageCount: number;
  rows: Array<
    Partial<ActivityRow> & {
      id: string;
      title: string;
      rank: number;
      likes: number;
      imports: number;
      score: number;
      reward: number;
      awardStatus?: string;
    }
  >;
};
type Detail = {
  campaign: Campaign;
  boards: Board[];
  settledAt?: string;
  frozenAt?: string;
  legacy?: boolean;
  closed?: boolean;
};
const time = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(new Date(value))
    : "未设置";

export default function ActivityRankingsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState("");
  const [listPage, setListPage] = useState(1);
  const [listPages, setListPages] = useState(1);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/activities?page=${listPage}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取活动失败");
        setItems(result.items);
        setListPages(result.pageCount);
        setSelected(
          (current) =>
            current ||
            new URL(window.location.href).searchParams.get("activity") ||
            result.items[0]?.id ||
            "",
        );
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [listPage, refresh]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void fetch(`/api/activities/${encodeURIComponent(selected)}?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取榜单失败");
        setDetail(result);
        setError("");
        window.history.replaceState(
          null,
          "",
          `/gallery/activities?activity=${encodeURIComponent(selected)}`,
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected, page, refresh]);
  useEffect(() => {
    const timer = setInterval(() => setRefresh((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="activity-page">
      <PublicHeader current="gallery" />
      <div className="activity-shell">
        <header className="activity-heading">
          <div>
            <Link href="/gallery">← 图片广场</Link>
            <h1>活动榜单</h1>
            <p>查看创作活动、实时排名与奖励。所有时间均为北京时间。</p>
          </div>
          <button
            className="lfn-button"
            onClick={() => setRefresh((n) => n + 1)}
          >
            刷新榜单
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">正在读取活动…</p>
        ) : items.length === 0 ? (
          <p>目前没有已公开的活动。</p>
        ) : (
          <>
            <nav className="activity-tabs" aria-label="选择活动">
              {items.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={selected === item.id}
                  onClick={() => {
                    setSelected(item.id);
                    setDetail(null);
                    setPage(1);
                  }}
                >
                  <strong>{item.name}</strong>
                  <span>{item.phase}</span>
                </button>
              ))}
            </nav>
            {listPages > 1 && (
              <div className="activity-pager">
                <button
                  disabled={listPage === 1}
                  onClick={() => setListPage((n) => n - 1)}
                >
                  上一页活动
                </button>
                <span>
                  {listPage} / {listPages}
                </span>
                <button
                  disabled={listPage >= listPages}
                  onClick={() => setListPage((n) => n + 1)}
                >
                  下一页活动
                </button>
              </div>
            )}
            {detail && (
              <>
                <section className="activity-overview">
                  <h2>{detail.campaign.name}</h2>
                  <p>{detail.campaign.summary}</p>
                  <p>
                    开始：{time(detail.campaign.startsAt)}　截止：
                    {time(detail.campaign.endsAt)}
                  </p>
                  {detail.legacy ? (
                    <p>
                      按原有周榜规则展示当前周数据，历史活动奖励以发放记录为准。
                    </p>
                  ) : (
                    <>
                      <p>
                        发奖：
                        {time(
                          detail.campaign.settlesAt || detail.campaign.endsAt,
                        )}{" "}
                        ·{" "}
                        {detail.settledAt
                          ? "已结算"
                          : detail.frozenAt
                            ? "已结榜，正在发奖"
                            : detail.closed
                              ? "已截止，等待自动结算"
                              : "实时排名"}
                      </p>
                      <p>
                        综合分 = 有效点赞 × {detail.campaign.scoring?.likes} +
                        有效导入 × {detail.campaign.scoring?.imports}
                        。每账号每作品一次导入计分，作者自身互动不计分。
                      </p>
                    </>
                  )}
                  <p>
                    投稿标签：
                    {(detail.campaign.requiredTags || []).join("、") ||
                      detail.campaign.requiredTag ||
                      "不限"}
                  </p>
                  <p className="activity-rules">{detail.campaign.rules}</p>
                  <Link
                    className="lfn-button"
                    href={`/gallery?tag=${encodeURIComponent(detail.campaign.requiredTags?.[0] || detail.campaign.requiredTag || "")}`}
                  >
                    查看参赛作品与投稿入口
                  </Link>
                </section>
                <div className="activity-boards">
                  {detail.boards.map((board) => (
                    <section className="activity-board" key={board.id}>
                      <h2>{board.name}</h2>
                      <p>
                        第 1 名 {board.rewards[0] || 0} · 第 2 名{" "}
                        {board.rewards[1] || 0} · 第 3 名{" "}
                        {board.rewards[2] || 0} AFF
                        {!detail.legacy &&
                          ` · 安慰奖 ${board.consolationReward} AFF`}
                      </p>
                      <p>{board.total} 件作品 · 作品排名与领奖名次分别显示</p>
                      {board.rows.length === 0 ? (
                        <p>暂无参赛作品。</p>
                      ) : (
                        <ol
                          className="activity-rows"
                          start={(page - 1) * 50 + 1}
                        >
                          {board.rows.map((row) => (
                            <li key={row.id}>
                              <span className="activity-rank">#{row.rank}</span>
                              <Link
                                className="activity-thumbnail"
                                href={`/gallery/${encodeURIComponent(row.id)}`}
                                aria-label={`查看作品：${row.title}`}
                              >
                                <Image
                                  width={68}
                                  height={84}
                                  unoptimized
                                  loading="lazy"
                                  src={`/api/gallery/${encodeURIComponent(row.id)}/image?variant=thumbnail`}
                                  alt=""
                                  className={
                                    row.rating === "r17" || row.rating === "r18"
                                      ? "is-sensitive"
                                      : ""
                                  }
                                />
                              </Link>
                              <div className="activity-work">
                                <Link
                                  href={`/gallery/${encodeURIComponent(row.id)}`}
                                  className="activity-name"
                                >
                                  {row.title}
                                </Link>
                                {row.originalFileName &&
                                  row.originalFileName !== row.title && (
                                    <span className="activity-filename">
                                      原文件：{row.originalFileName}
                                    </span>
                                  )}
                                <span>
                                  {row.authorName || row.ownerName}
                                  {row.noOriginalData ? " · 无原数据图" : ""}
                                  {row.upscaled ? " · 超分图" : ""}
                                </span>
                                <span>
                                  ♥ {row.likes} 有效点赞 · ↗ {row.imports}{" "}
                                  有效导入 · 综合分 {row.score}
                                </span>
                                <span>
                                  {row.rewardRank !== undefined
                                    ? `${row.rewardRank <= 3 ? `领奖第 ${row.rewardRank} 名` : "安慰奖"} · ${row.reward} AFF`
                                    : detail.legacy
                                      ? `预计 ${row.reward} AFF`
                                      : "同作者其他作品，不重复领奖"}
                                  {row.awardStatus === "granted"
                                    ? " · 已到账"
                                    : row.awardStatus === "failed"
                                      ? " · 发放重试中"
                                      : ""}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>
                  ))}
                </div>
                {Math.max(...detail.boards.map((b) => b.pageCount)) > 1 && (
                  <div className="activity-pager">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage((n) => n - 1)}
                    >
                      上一页作品
                    </button>
                    <span>
                      {page} /{" "}
                      {Math.max(...detail.boards.map((b) => b.pageCount))}
                    </span>
                    <button
                      disabled={
                        page >=
                        Math.max(...detail.boards.map((b) => b.pageCount))
                      }
                      onClick={() => setPage((n) => n + 1)}
                    >
                      下一页作品
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

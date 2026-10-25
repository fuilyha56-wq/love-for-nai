import type { ReactNode } from "react";
import { Aperture, Bell, BookOpen, BookText, Brush, ChartNoAxesColumn, Coins, Images, LogIn, Megaphone, Settings, ShieldCheck, Sparkles, Tags, UserRound, Users } from "lucide-react";
import Link from "next/link";

type PublicHeaderProps = {
  current?: "prompts" | "settings" | "pricing" | "docs" | "models" | "gallery" | "announcements" | "stories" | "notifications" | "studio" | "verify" | "tags" | "usage" | "profile";
  actionLabel?: string;
  actionHref?: string;
  extraActions?: ReactNode;
};
const identities = {
  prompts: ["提示词库", BookOpen], settings: ["设置", Settings], pricing: ["价格说明", Coins],
  docs: ["使用与 API 文档", BookOpen], models: ["模型目录", Aperture], gallery: ["图片广场", Images],
  announcements: ["站点公告", Megaphone], stories: ["故事工作台", BookText], notifications: ["消息", Bell],
  studio: ["创作者工作台", Users], verify: ["图片溯源检测", ShieldCheck], tags: ["标签词库", Tags],
  usage: ["使用记录", ChartNoAxesColumn],
  profile: ["我的账号", UserRound],
} as const;

export function PublicHeader({ current, actionLabel, actionHref = "/image", extraActions }: PublicHeaderProps) {
  const [title, Icon] = current ? identities[current] : ["Love for NAI", Brush];
  return <header className="lfn-public-header"><div className="lfn-public-header-content flex items-center gap-3">
    <div className="launcher-page-identity"><Icon size={21} aria-hidden="true" /><h1>{title}</h1></div>
    <span className="launcher-toolbar-spacer" />
    {extraActions}
    {actionLabel && <Link href={actionHref} prefetch={false} className="lfn-public-header-action flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-[var(--surface-muted)] px-3 text-xs font-semibold text-[var(--ink)]"><LogIn size={16} /><span className="hidden sm:inline">{actionLabel}</span><span className="sm:hidden">画布</span></Link>}
  </div></header>;
}

export function PublicPageIntro({ description }: { eyebrow: string; title: string; description: string }) {
  return <div className="launcher-page-intro max-w-3xl"><p>{description}</p></div>;
}
export function PublicBrandMark() { return <Sparkles size={18} className="text-[var(--rose)]" aria-hidden="true" />; }

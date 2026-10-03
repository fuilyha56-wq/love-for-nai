"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BookOpen,
  BookText,
  Coins,
  History,
  House,
  Images,
  Megaphone,
  Palette,
  UserRound,
  BriefcaseBusiness,
} from "lucide-react";

const destinations = [
  {
    href: "/",
    label: "首页",
    detail: "返回 Love for NAI 首页。",
    icon: House,
    group: "导航",
  },
  {
    href: "/stories",
    label: "故事工作台",
    detail: "续写、分支并管理你的长篇故事。",
    icon: BookText,
    group: "创作",
  },
  {
    href: "/account",
    label: "我的账号",
    detail: "管理资料、钱包和创作额度。",
    icon: UserRound,
    group: "账号",
  },
  {
    href: "/history",
    label: "图片历史",
    detail: "回看最近的创作，继续打磨灵感。",
    icon: History,
    group: "创作",
  },
  {
    href: "/gallery",
    label: "图片广场",
    detail: "发现作品，分享你的创作。",
    icon: Images,
    group: "创作",
  },
  {
    href: "/studio",
    label: "创作者工作台",
    detail: "查看投稿审核状态，管理创作者资料。",
    icon: BriefcaseBusiness,
    group: "创作",
  },
  {
    href: "/usage",
    label: "使用记录",
    detail: "查看每一次调用与余额消耗。",
    icon: Coins,
    group: "账号",
  },
  {
    href: "/profile",
    label: "个人资料",
    detail: "编辑显示名称、奖励和账户安全。",
    icon: UserRound,
    group: "账号",
  },
  {
    href: "/settings",
    label: "设置",
    detail: "管理外观、个人资料、模型密钥和提示词库。",
    icon: Palette,
    group: "设置",
  },
  {
    href: "/announcements",
    label: "站点公告",
    detail: "了解最近的更新与站点消息。",
    icon: Megaphone,
    group: "发现",
  },
] as const;

export function WorkspaceNav() {
  const pathname = usePathname();
  const current =
    destinations.find((item) => item.href === pathname) ??
    (pathname === "/keys" || pathname === "/resources"
      ? destinations[8]
      : pathname === "/profile"
        ? destinations[7]
        : destinations[1]);
  return (
    <div className="workspace-heading">
      <nav className="workspace-tabs" aria-label="工作台页面导航">
        {destinations.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={
              pathname === href ||
              (href === "/settings" && (pathname === "/keys" || pathname === "/resources"))
                ? "page"
                : undefined
            }
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="workspace-intro">
        <div>
          <p className="workspace-eyebrow">
            LOVE FOR NAI <span>/ {current.group}</span>
          </p>
          <h1>{current.label}</h1>
          <p className="workspace-description">{current.detail}</p>
        </div>
        <Link className="workspace-help" href="/docs">
          <BookOpen size={16} /> 使用指南 <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );
}

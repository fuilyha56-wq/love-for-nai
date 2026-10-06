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
  MoreHorizontal,
  Palette,
  UserRound,
  BriefcaseBusiness,
  X,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const workspaceDestinations = [
  { href: "/", label: "首页", detail: "返回 Love for NAI 首页。", icon: House, group: "导航" },
  { href: "/stories", label: "故事工作台", detail: "续写、分支并管理你的长篇故事。", icon: BookText, group: "创作" },
  { href: "/profile", label: "我的账号", detail: "管理资料、钱包、图包、奖励和账户安全。", icon: UserRound, group: "账号" },
  { href: "/history", label: "图片历史", detail: "回看最近的创作，继续打磨灵感。", icon: History, group: "创作" },
  { href: "/verify", label: "图片溯源检测", detail: "验证图片签名并查询生成记录。", icon: ShieldCheck, group: "工具" },
  { href: "/gallery", label: "图片广场", detail: "发现作品，分享你的创作。", icon: Images, group: "创作" },
  { href: "/studio", label: "创作者工作台", detail: "查看投稿审核状态，管理创作者资料。", icon: BriefcaseBusiness, group: "创作" },
  { href: "/usage", label: "使用记录", detail: "查看每一次调用与余额消耗。", icon: Coins, group: "账号" },
  { href: "/settings", label: "设置", detail: "管理外观、个人资料、模型密钥和提示词库。", icon: Palette, group: "设置" },
  { href: "/announcements", label: "站点公告", detail: "了解最近的更新与站点消息。", icon: Megaphone, group: "发现" },
] as const;

const mobilePrimary = [
  { href: "/", label: "首页", icon: House },
  { href: "/image", label: "创作", icon: Palette },
  { href: "/history", label: "历史", icon: History },
  { href: "/profile", label: "账号", icon: UserRound },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/image") return pathname === "/image" || pathname.startsWith("/image/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceNav() {
  const pathname = usePathname();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const current = workspaceDestinations.find((item) => item.href === pathname)
    ?? (pathname === "/keys" || pathname === "/resources" ? workspaceDestinations[8]
      : pathname === "/profile" ? workspaceDestinations[2]
        : pathname === "/image" ? { ...workspaceDestinations[1], label: "创作工作台", detail: "生成图片、编辑参考图并管理创作参数。" }
          : workspaceDestinations[1]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMoreOpen]);

  useEffect(() => {
    void Promise.resolve().then(() => setMobileMoreOpen(false));
  }, [pathname]);

  return (
    <div className="workspace-heading">
      <nav className="workspace-tabs" aria-label="工作台页面导航">
        {workspaceDestinations.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={isActivePath(pathname, href) ? "page" : undefined}>
            <Icon size={16} aria-hidden="true" /><span>{label}</span>
          </Link>
        ))}
      </nav>
      <nav className="workspace-mobile-nav" aria-label="移动端工作台页面导航">
        <div className="workspace-mobile-primary">
          {mobilePrimary.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActivePath(pathname, href) ? "page" : undefined}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </Link>
          ))}
          <button
            ref={moreButtonRef}
            type="button"
            aria-expanded={mobileMoreOpen}
            aria-controls="workspace-mobile-more"
            onClick={() => setMobileMoreOpen((open) => !open)}
          >
            <MoreHorizontal size={18} aria-hidden="true" /><span>更多</span>
          </button>
        </div>
        {mobileMoreOpen && (
          <>
            <button className="workspace-mobile-backdrop" type="button" aria-label="关闭更多导航" onClick={() => setMobileMoreOpen(false)} />
            <div id="workspace-mobile-more" className="workspace-mobile-more" role="dialog" aria-label="更多工作台页面">
              <div className="workspace-mobile-more-heading">
                <span>更多入口</span>
                <button type="button" aria-label="关闭更多导航" onClick={() => { setMobileMoreOpen(false); moreButtonRef.current?.focus(); }}><X size={18} /></button>
              </div>
              <div className="workspace-mobile-more-grid">
                {workspaceDestinations.filter(({ href }) => !mobilePrimary.some((item) => item.href === href)).map(({ href, label, icon: Icon, detail }) => (
                  <Link key={href} href={href} aria-current={isActivePath(pathname, href) ? "page" : undefined}>
                    <Icon size={17} aria-hidden="true" />
                    <span><b>{label}</b><small>{detail}</small></span>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </nav>
      <div className="workspace-intro">
        <div>
          <p className="workspace-eyebrow">LOVE FOR NAI <span>/ {current.group}</span></p>
          <h1>{current.label}</h1>
          <p className="workspace-description">{current.detail}</p>
        </div>
        <Link className="workspace-help" href="/docs"><BookOpen size={16} /> 使用指南 <ArrowUpRight size={14} /></Link>
      </div>
    </div>
  );
}

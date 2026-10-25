"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Aperture, Bell, BookOpen, BookText, Brush, ChartNoAxesColumn, ChevronLeft, ChevronRight, Coins, Folder, Images, KeyRound, LayoutDashboard, Megaphone, MoreHorizontal, Scan, Settings, ShieldCheck, Tags, UserRound, Users, X } from "lucide-react";
import { useDialogFocus } from "./ui/use-dialog-focus";
import "./launcher-shell.css";

// Same branch order and shell geometry as Aaalice's AppBranch/MainNavRail.
// LFn-only destinations share the shell instead of creating a separate website nav.
export const launcherDestinations = [
  { href: "/image", label: "画布", icon: Brush },
  { href: "/history", label: "图片历史", icon: Folder },
  { href: "/gallery", label: "图片广场", icon: Images },
  { href: "/tags", label: "标签词库", icon: Tags },
  { href: "/settings#prompts", label: "提示词库", icon: BookOpen },
  { href: "/image/editor", label: "图像编辑器", icon: Scan },
  { href: "/image/editor/history", label: "重绘历史", icon: Folder },
  { href: "/stories", label: "故事工作台", icon: BookText },
  { href: "/studio", label: "创作者工作台", icon: Users },
  { href: "/usage", label: "使用记录", icon: ChartNoAxesColumn },
  { href: "/profile", label: "我的账号", icon: UserRound },
  { href: "/notifications", label: "消息", icon: Bell },
  { href: "/verify", label: "图片溯源检测", icon: ShieldCheck },
  { href: "/models", label: "模型目录", icon: Aperture },
  { href: "/pricing", label: "价格说明", icon: Coins },
  { href: "/docs", label: "使用与 API 文档", icon: BookOpen },
  { href: "/announcements", label: "站点公告", icon: Megaphone },
  { href: "/settings#models", label: "模型与密钥", icon: KeyRound },
  { href: "/settings", label: "设置", icon: Settings },
] as const;

export function launcherPathActive(pathname: string, href: string) {
  if (href.includes("#")) return false;
  if (href === "/image") return pathname === "/image";
  if (href === "/image/editor") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const destinationGroups = [
  { title: "创作与工具", hrefs: ["/settings#prompts", "/image/editor", "/image/editor/history", "/stories", "/studio", "/verify"] },
  { title: "账号与记录", hrefs: ["/profile", "/notifications", "/usage"] },
  { title: "模型与用量", hrefs: ["/settings#models", "/models", "/pricing"] },
  { title: "帮助与设置", hrefs: ["/docs", "/announcements", "/settings"] },
];

export function LauncherDestinationGroups({ admin = false, workspace = false, onNavigate }: { admin?: boolean; workspace?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav className="launcher-destination-groups" aria-label="更多页面分类">{destinationGroups.map(group => <section className="launcher-destination-group" key={group.title} aria-label={group.title}>
    <h2>{group.title}</h2><div>{group.hrefs.map(href => {
      const item = launcherDestinations.find(destination => destination.href === href)!;
      const Icon = item.icon;
      return <Link key={href} href={href} prefetch={false} onClick={onNavigate} aria-current={launcherPathActive(pathname, href) ? "page" : undefined}><Icon size={20} aria-hidden="true" /><span>{item.label}</span></Link>;
    })}{group.title === "帮助与设置" && workspace && <Link href="/image/setting/layout" onClick={onNavigate}><LayoutDashboard size={20} /><span>工作台布局</span></Link>}{group.title === "账号与记录" && admin && <Link href="/admin" onClick={onNavigate}><ShieldCheck size={20} /><span>管理中心</span></Link>}</div>
  </section>)}</nav>;
}

export function LauncherShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useDialogFocus(moreOpen, moreRef);
  useEffect(() => {
    const restore = window.requestAnimationFrame(() => { try { setExpanded(localStorage.getItem("lfn-mobile-launcher-rail-expanded") === "1"); } catch { /* Session-only navigation still works when storage is unavailable. */ } });
    return () => cancelAnimationFrame(restore);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin", { signal: controller.signal }).then(response => response.ok ? response.json() : { admin: false }).then(result => { if (!controller.signal.aborted) setAdmin(result.admin === true); }).catch(() => undefined);
    return () => controller.abort();
  }, [pathname]);
  const imageViewer = pathname.startsWith("/gallery/") || pathname.startsWith("/history/");
  const immersive = imageViewer || pathname === "/image" || pathname === "/image/editor" || pathname === "/image/setting/layout";
  const primary = launcherDestinations.slice(0, 4);
  const primaryActive = primary.some(item => launcherPathActive(pathname, item.href));
  const changeRail = () => setExpanded(value => { try { localStorage.setItem("lfn-mobile-launcher-rail-expanded", value ? "0" : "1"); } catch { /* Keep the current session usable. */ } return !value; });
  return <div className="launcher-shell" data-rail-expanded={expanded} data-launcher-route={pathname} data-immersive={immersive} data-image-viewer={imageViewer}>
    <a href="#launcher-content" className="launcher-skip-link">跳到页面内容</a>
    <div className="launcher-titlebar"><Link href="/image" prefetch={false}><Aperture size={17} /><b>Love for NAI</b></Link><span>创作工作台</span></div>
    <aside className="launcher-rail" aria-label="应用侧边导航" inert={moreOpen}>
      <Link className="launcher-account" href="/profile" title="我的账号" aria-label="我的账号"><UserRound size={24} /><span>Love for NAI</span></Link>
      <nav aria-label="应用页面导航">{launcherDestinations.slice(0, 12).map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={false} title={label} aria-current={launcherPathActive(pathname, href) ? "page" : undefined}><Icon size={21} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
      {admin && <Link href="/admin" title="管理中心" aria-current={launcherPathActive(pathname, "/admin") ? "page" : undefined}><ShieldCheck size={21} /><span>管理中心</span></Link>}
      <button type="button" title="更多页面" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><MoreHorizontal size={21} /><span>更多页面</span></button>
      <Link href="/settings" title="设置" aria-current={launcherPathActive(pathname, "/settings") ? "page" : undefined}><Settings size={21} aria-hidden="true" /><span>设置</span></Link>
      <button className="launcher-rail-toggle" type="button" onClick={changeRail} aria-label={expanded ? "折叠应用导航" : "展开应用导航"} aria-expanded={expanded}>{expanded ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}<span>收起导航</span></button>
    </aside>
    <div id="launcher-content" tabIndex={-1} className="launcher-content" inert={moreOpen}>{children}</div>
    {!immersive && <nav className="launcher-bottom-nav" aria-label="移动应用导航">{primary.map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={false} aria-current={launcherPathActive(pathname, href) ? "page" : undefined}><Icon size={21} aria-hidden="true" /><span>{label}</span></Link>)}<button type="button" aria-label="更多页面" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={!primaryActive ? "page" : undefined} onClick={() => setMoreOpen(true)}><MoreHorizontal size={22} /><span>更多</span></button></nav>}
    {moreOpen && createPortal(<div className="launcher-more-backdrop" onClick={() => setMoreOpen(false)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setMoreOpen(false); } }}>
      <div ref={moreRef} tabIndex={-1} className="launcher-more" role="dialog" aria-modal="true" aria-label="更多页面" onClick={event => event.stopPropagation()}><header><b>更多</b><button type="button" aria-label="关闭更多页面" onClick={() => setMoreOpen(false)}><X size={20} /></button></header><LauncherDestinationGroups admin={admin} onNavigate={() => setMoreOpen(false)} /></div>
    </div>, document.body)}
  </div>;
}

"use client";

import Link from "next/link";
import { History, Images, MoreHorizontal, Sparkles, Tags } from "lucide-react";
import "./mobile-bottom-nav.css";

export type MobileNavigationPage = "generate" | "history" | "gallery" | "tags" | "more";
const destinations = [
  { id: "generate", href: "/image", label: "生成", icon: Sparkles },
  { id: "history", href: "/image?view=history", label: "历史", icon: History },
  { id: "gallery", href: "/gallery", label: "广场", icon: Images },
  { id: "tags", href: "/tags", label: "词库", icon: Tags },
  { id: "more", href: "/image?view=more", label: "更多", icon: MoreHorizontal },
] as const;

export function MobileBottomNav({ active, className = "", inert, onWorkspacePage }: {
  active: MobileNavigationPage;
  className?: string;
  inert?: boolean;
  onWorkspacePage?: (page: "generate" | "history" | "more") => void;
}) {
  return <nav className={`mobile-bottom-nav ${className}`} aria-label="移动工作台导航" inert={inert}>
    {destinations.map(({ id, href, label, icon: Icon }) => {
      const content = <><Icon size={21} aria-hidden="true" /><span>{label}</span></>;
      const current = active === id ? "page" as const : undefined;
      return onWorkspacePage && (id === "generate" || id === "history" || id === "more")
        ? <button key={id} type="button" aria-current={current} onClick={() => onWorkspacePage(id)}>{content}</button>
        : <Link key={id} href={href} prefetch={false} aria-current={current}>{content}</Link>;
    })}
  </nav>;
}

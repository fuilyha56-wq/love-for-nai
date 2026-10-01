"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, KeyRound, Palette, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { settingsSectionForHash, type SettingsSection } from "@/lib/settings-navigation";
import AppearanceSettings from "./appearance-settings";
import GuideSettings from "./guide-settings";
import ModelKeySettings from "./model-key-settings";
import ProfileSettings from "./profile-settings";
import PromptLibrarySettings from "./prompt-library-settings";
import "./settings.css";

const sections = [
  { id: "appearance", label: "外观与界面", description: "主题、色泽、工作台布局和指南入口", icon: Palette },
  { id: "profile", label: "个人资料", description: "用户名、显示名称及个人页面", icon: UserRound },
  { id: "models", label: "模型与密钥", description: "图像和故事模型来源、NovelAI Key、LFN 对外密钥", icon: KeyRound },
  { id: "prompts", label: "提示词库", description: "自定义质量词、UC 预设与模型写法", icon: BookOpen },
] satisfies Array<{ id: SettingsSection; label: string; description: string; icon: typeof Palette }>;

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export default function SettingsHub() {
  const active = useSyncExternalStore(subscribeHash, () => settingsSectionForHash(window.location.hash), () => "appearance" as SettingsSection);
  const navigation = useRef<HTMLElement>(null);
  const current = sections.find((item) => item.id === active)!;
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash === `#${active}`) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    const timer = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 100);
    return () => window.clearTimeout(timer);
  }, [active]);

  return <main className="settings-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
    <header className="settings-header">
      <Link href="/settings" className="settings-brand"><Settings size={20} /><b>设置</b><span>Love for NAI</span></Link>
      <Link href="/image" prefetch={false} className="settings-secondary-button"><ArrowLeft size={16} /> 返回工作台</Link>
    </header>
    <div className="settings-layout">
      <nav className="settings-navigation" aria-label="设置分类" ref={navigation}>
        {sections.map(({ id, label, icon: Icon }, index) => <a key={id} href={`#${id}`} aria-current={active === id ? "page" : undefined} onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + sections.length) % sections.length;
          const link = navigation.current?.querySelectorAll<HTMLAnchorElement>("a")[nextIndex];
          link?.focus();
          link?.click();
        }}><Icon size={18} /><span>{label}</span></a>)}
      </nav>
      <section className="settings-content" aria-labelledby="settings-section-title">
        <div className="settings-section-heading"><p>设置 / {current.label}</p><h1 id="settings-section-title">{current.label}</h1><span>{current.description}</span></div>
        <div className="settings-section-body" key={active}>
          {active === "appearance" && <><AppearanceSettings /><div className="mt-6"><GuideSettings /></div></>}
          {active === "profile" && <ProfileSettings />}
          {active === "models" && <ModelKeySettings />}
          {active === "prompts" && <PromptLibrarySettings />}
        </div>
      </section>
    </div>
  </main>;
}

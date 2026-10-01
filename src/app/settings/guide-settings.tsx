"use client";

import { Compass } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { guideLauncherVisible, openOnboardingGuide, setGuideLauncherVisible, subscribeGuideVisibility } from "@/lib/guide-preferences";

export default function GuideSettings() {
  const visible = useSyncExternalStore(subscribeGuideVisibility, guideLauncherVisible, () => true);
  const [message, setMessage] = useState("");
  return <article className="panel rounded-md p-5 sm:p-6">
    <h3 className="flex items-center gap-2 font-semibold"><Compass size={18} className="text-[var(--rose)]" /> 新手指南</h3>
    <p className="mt-2 text-xs leading-6 text-[var(--muted)]">控制工作台右下角的指南入口。隐藏后仍可从这里重新打开教程。</p>
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={visible} onChange={(event) => setMessage(setGuideLauncherVisible(event.target.checked) ? "" : "浏览器无法保存指南偏好，请检查本地存储权限。")} /> 显示浮动指南按钮
      </label>
      <button type="button" className="settings-secondary-button" onClick={openOnboardingGuide}>重新打开新手教程</button>
    </div>
    {message && <p role="status" className="mt-3 text-xs text-[var(--rose)]">{message}</p>}
  </article>;
}

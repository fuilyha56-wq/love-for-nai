import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/noto-sans-sc/700.css";
import "./globals.css";
import "./lfn-controls.css";
import "@/mobile/lfn-controls.css";
import { createAppearancePrepaintScript } from "@/lib/appearance-store";
import { createAppearancePrepaintScript as createMobilePrepaintScript } from "@/mobile/lib/appearance-store";
import { ViewportRoot } from "./viewport-root";

export const metadata: Metadata = {
  title: "Love for NAI",
  description: "为 NovelAI 创作者打造的中文图像工作台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

// 首帧前应用本地外观，避免刷新时先闪默认主题。解析规则由 appearance-store 统一生成，
// Provider 在恢复本地偏好后会再次应用规范化结果；背景图在 IndexedDB，仍由 Provider 异步恢复。
const APPEARANCE_PREPAINT = `(function(){var mobile=window.matchMedia("(max-width: 1023px)").matches;document.documentElement.dataset.clientViewport=mobile?"mobile":"desktop";if(mobile){try{for(var key of ["lfn-onboarding-v1","lfn-guide-launcher-visible"]){var mobileKey=key.replace("lfn-","lfn-mobile-");var oldValue=localStorage.getItem(key);if(localStorage.getItem(mobileKey)===null&&oldValue!==null)localStorage.setItem(mobileKey,oldValue);}if(!localStorage.getItem("lfn-mobile-ui-preferences-v1")){var old=localStorage.getItem("lfn-ui-preferences-v1");if(old){var prefs=JSON.parse(old);prefs.workspaceLayout="nlw";prefs.backgroundEnabled=false;localStorage.setItem("lfn-mobile-ui-preferences-v1",JSON.stringify(prefs));}}}catch{}${createMobilePrepaintScript()}}else{${createAppearancePrepaintScript()}}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning：pre-paint 脚本会在水合前把本地外观写到
    // html/body（data-theme、背景等），这些属性是刻意不参与服务端渲染的。
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_PREPAINT }} />
        <ViewportRoot>
          {children}
        </ViewportRoot>
      </body>
    </html>
  );
}

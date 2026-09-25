import type { Metadata, Viewport } from "next";
// NAI 同款字体：正文 Source Sans 3（CJK 回落 Noto Sans SC/雅黑），标题 Eczar。
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import "@fontsource/eczar/400.css";
import "@fontsource/eczar/600.css";
import "@fontsource/eczar/700.css";
import "./globals.css";
import { AppearanceProvider } from "./appearance";
import { LayoutAnnouncements } from "./layout-announcements";
import { OnboardingGuide } from "./onboarding-guide";

export const metadata: Metadata = {
  title: "Love for NAI",
  description: "为 NovelAI 创作者打造的中文图像工作台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>
        <AppearanceProvider>
          {children}
          <LayoutAnnouncements />
          <OnboardingGuide />
        </AppearanceProvider>
      </body>
    </html>
  );
}

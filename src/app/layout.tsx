import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppearanceProvider } from "./appearance";
import { LayoutAnnouncements } from "./layout-announcements";

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
        </AppearanceProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Love for NAI",
  description: "为 NovelAI 创作者打造的中文图像工作台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

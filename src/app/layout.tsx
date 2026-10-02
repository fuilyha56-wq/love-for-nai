import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/noto-sans-sc/700.css";
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

// 首帧前应用本地外观（主题/强调色/玻璃/网格/密度），避免刷新时先闪默认宣纸主题。
// 与 appearance.tsx 的 token 保持一致；背景图在 IndexedDB，仍由 Provider 异步恢复。
const APPEARANCE_PREPAINT = `(function(){try{
var raw=localStorage.getItem("lfn-ui-preferences-v1");if(!raw)return;
var p=JSON.parse(raw);if(!p||typeof p!=="object")return;
var THEMES={paper:{paper:"#f7f6f2",panel:"#fffefa",line:"#deddd7",ink:"#202328",muted:"#71767c"},dusk:{paper:"#eee9e4",panel:"#fffaf5",line:"#d8cbc2",ink:"#30282a",muted:"#796c6d"},night:{paper:"#17191d",panel:"#22252b",line:"#3a3e47",ink:"#f1eee8",muted:"#a6aab2"},nai:{paper:"#13152c",panel:"#191b31",line:"#22253f",ink:"#ffffff",muted:"#b3b4c8"}};
var ACCENTS={rose:{base:"#a83a4c",dark:"#7f2637"},mint:{base:"#2d7567",dark:"#205649"},gold:{base:"#b47c2a",dark:"#805719"},violet:{base:"#7658a8",dark:"#503b7c"},indigo:{base:"#6c7fff",dark:"#4a57d6"}};
var t=THEMES[p.theme]||THEMES.paper;var a=ACCENTS[p.accentPreset]||ACCENTS.rose;
var rose=(typeof p.customAccent==="string"&&/^#[0-9a-fA-F]{6}$/.test(p.customAccent))?p.customAccent:a.base;
var r=document.documentElement,s=r.style;
r.dataset.theme=p.theme in THEMES?p.theme:"paper";
r.dataset.glass=p.glass?"on":"off";
r.dataset.motion=p.motion==="reduced"?"reduced":"full";
r.dataset.grid=p.grid===false?"off":"on";
r.dataset.density=p.density==="compact"?"compact":"comfortable";
s.setProperty("--paper",t.paper);s.setProperty("--panel",t.panel);s.setProperty("--line",t.line);
s.setProperty("--ink",t.ink);s.setProperty("--muted",t.muted);
s.setProperty("--rose",rose);s.setProperty("--rose-dark",rose===a.base?a.dark:"color-mix(in srgb, "+rose+" 76%, #000)");
s.setProperty("--mint",ACCENTS.mint.base);s.setProperty("--gold",ACCENTS.gold.base);
var gs=(typeof p.glassStrength==="number"&&isFinite(p.glassStrength))?Math.max(0,Math.min(100,p.glassStrength)):42;
var gAlpha=Math.round(46-gs*0.26),gBlur=Math.round(12+gs*0.28);
s.setProperty("--lfn-glass-opacity",p.glass?String(0.5+gs/200):"0");
s.setProperty("--lfn-glass-blur",p.glass?gBlur+"px":"0px");
s.setProperty("--glass-alpha",p.glass?gAlpha+"%":"100%");
s.setProperty("--glass-blur",p.glass?gBlur+"px":"0px");
s.setProperty("--glass-saturation",p.glass?String(1.3+gs/250):"1");
var tint=r.dataset.theme==="nai"?"rgba(255, 255, 255, 0.03)":"rgba(56, 52, 45, 0.035)";
var layers=p.grid===false?[]:["linear-gradient("+tint+" 1px, transparent 1px)","linear-gradient(90deg, "+tint+" 1px, transparent 1px)"];
var b=document.body.style;
b.backgroundImage=layers.join(", ")||"none";
b.backgroundSize=layers.map(function(){return "24px 24px";}).join(", ")||"auto";
b.backgroundPosition=layers.map(function(){return "0 0";}).join(", ")||"0 0";
b.backgroundAttachment=layers.map(function(){return "scroll";}).join(", ")||"scroll";
b.backgroundColor=t.paper;
}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning：pre-paint 脚本会在水合前把本地外观写到
    // html/body（data-theme、背景等），这些属性是刻意不参与服务端渲染的。
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_PREPAINT }} />
        <AppearanceProvider>
          {children}
          <LayoutAnnouncements />
          <OnboardingGuide />
        </AppearanceProvider>
      </body>
    </html>
  );
}

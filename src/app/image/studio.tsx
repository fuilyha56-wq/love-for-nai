"use client";

import { Aperture, BookOpen, ChevronDown, Clock3, Code2, Download, ImagePlus, Menu, RotateCcw, SlidersHorizontal, Sparkles, UserRound, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Props = { userName: string; authenticated: boolean };
type Me = { user?: { balance: number | null; group: string } };
const sizes = ["832 × 1216", "1024 × 1024", "1216 × 832"];
const models = ["NAI Diffusion V5 Full", "NAI Diffusion V5 Curated", "NAI Diffusion V4.5 Full", "NAI Diffusion V3"];

export default function ImageStudio({ userName, authenticated }: Props) {
  const [model, setModel] = useState(models[0]);
  const [size, setSize] = useState(sizes[0]);
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [prompt, setPrompt] = useState("masterpiece, best quality, 1girl, white hair, crimson eyes, intricate kimono, soft window light");
  const [negative, setNegative] = useState("lowres, bad anatomy, blurry, text, watermark");
  const [notice, setNotice] = useState("");
  const [mobilePanel, setMobilePanel] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { if (authenticated) fetch("/api/me").then(response => response.json()).then(setMe).catch(() => setMe(null)); }, [authenticated]);

  const controls = <><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4"><b className="flex items-center gap-2"><SlidersHorizontal size={17} /> 生成设置</b><button title="重置参数" onClick={() => { setSteps(28); setScale(5); setSize(sizes[0]); }}><RotateCcw size={17} /></button></div><div className="space-y-6 overflow-y-auto p-5">
    <Control label="模型"><select className="field h-10 px-3" value={model} onChange={event => setModel(event.target.value)}>{models.map(item => <option key={item}>{item}</option>)}</select></Control>
    <Control label="画布尺寸"><div className="grid grid-cols-3 gap-2">{sizes.map(item => <button key={item} onClick={() => setSize(item)} className={`min-h-14 rounded-md border px-2 text-xs ${size === item ? "border-[var(--rose)] bg-[#faeef0] text-[var(--rose)]" : "border-[var(--line)] bg-white"}`}>{item}</button>)}</div></Control>
    <Control label={`采样步数 · ${steps}`}><input className="range w-full" type="range" min="1" max="50" value={steps} onChange={event => setSteps(Number(event.target.value))} /></Control>
    <Control label={`提示词相关性 · ${scale}`}><input className="range w-full" type="range" min="1" max="10" step="0.1" value={scale} onChange={event => setScale(Number(event.target.value))} /></Control>
    <div className="grid grid-cols-2 gap-3"><Control label="采样器"><select className="field h-10 px-2 text-sm"><option>k_euler_ancestral</option><option>k_dpmpp_2m</option></select></Control><Control label="噪声调度"><select className="field h-10 px-2 text-sm"><option>karras</option><option>native</option></select></Control></div>
    <Control label="种子"><input className="field h-10 px-3" placeholder="随机" inputMode="numeric" /></Control><button className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--line)] bg-white text-sm"><ImagePlus size={17} /> 添加参考图片</button>
  </div></>;

  function generate() { setNotice(authenticated ? "真实生图暂未开放，当前版本先验证账号、余额与工作台交互，避免测试期间误扣费。" : "体验模式不会发送真实请求。登录后可以读取你的 NewAPI 余额与分组。"); }

  return <main className="flex h-screen min-h-[700px] flex-col overflow-hidden bg-[var(--paper)]">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[#fffefa]/95 px-4 lg:px-6"><div className="flex items-center gap-3"><Aperture className="text-[var(--rose)]" size={25} /><span className="font-[var(--font-display)] text-xl font-bold">Love for NAI</span><span className="hidden text-xs text-[var(--muted)] sm:inline">IMAGE STUDIO</span></div><nav className="hidden items-center gap-7 text-sm md:flex"><b className="text-[var(--rose)]">创作</b><span className="text-[var(--muted)]">历史</span><span className="text-[var(--muted)]">模型</span></nav><div className="flex items-center gap-2"><a title="源代码与 AGPL-3.0 许可证" href="https://github.com/fuilyha56-wq/love-for-nai" target="_blank" rel="noreferrer" className="hidden h-9 w-9 place-items-center rounded-md border border-[var(--line)] bg-white sm:grid"><Code2 size={16} /></a><span className={`hidden rounded px-2 py-1 text-xs sm:inline ${authenticated ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{authenticated ? "已连接 NewAPI" : "体验模式"}</span><button className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm"><UserRound size={16} />{userName}<ChevronDown size={14} /></button></div></header>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[292px_minmax(480px,1fr)_280px]">
      <aside className="panel hidden min-h-0 border-y-0 border-l-0 lg:flex lg:flex-col">{controls}</aside>
      <section className="flex min-h-0 flex-col"><div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3 lg:hidden"><button onClick={() => setMobilePanel(true)} className="flex items-center gap-2 text-sm"><Menu size={18} /> 生成设置</button><span className="text-xs text-[var(--muted)]">{size}</span></div>
        <div className="grid shrink-0 gap-3 border-b border-[var(--line)] bg-[#f2f0ea] p-4 xl:grid-cols-2"><Prompt label="描述画面" value={prompt} onChange={setPrompt} accent /><Prompt label="排除内容" value={negative} onChange={setNegative} /></div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5 lg:p-9"><div className="absolute left-5 top-4 flex items-center gap-2 text-xs text-[var(--muted)]"><Sparkles size={14} /> 当前画布 · {size}</div><div className="flex aspect-[832/1216] max-h-[calc(100vh-310px)] max-w-full flex-col items-center justify-center border border-[var(--line)] bg-[#ebe9e2] px-8 text-center shadow-[0_20px_70px_rgba(50,45,40,.12)]"><WandSparkles className="mb-5 text-[var(--rose)]" size={38} strokeWidth={1.5} /><h2 className="font-[var(--font-display)] text-2xl">画布等待你的想象</h2><p className="mt-3 max-w-xs text-sm leading-6 text-[var(--muted)]">调整提示词与参数，然后开始生成。结果会保留完整参数，方便再次创作。</p></div></div>
        {notice && <div className="mx-4 mb-3 flex items-start justify-between rounded-md border border-[#e4c991] bg-[#fff8e8] px-4 py-3 text-sm text-[#77531e]"><span>{notice}</span><button onClick={() => setNotice("")}><X size={16} /></button></div>}
        <div className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] bg-[#fffefa] p-3 lg:px-5"><div className="hidden min-w-32 sm:block"><p className="text-[10px] text-[var(--muted)]">预估消费</p><p className="text-sm font-semibold">约 0.14 余额</p></div><button onClick={generate} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-[var(--rose)] font-semibold text-white hover:bg-[var(--rose-dark)]"><Sparkles size={18} />开始生成</button><button title="下载" className="grid h-12 w-12 place-items-center rounded-md border border-[var(--line)] bg-white"><Download size={19} /></button></div>
      </section>
      <aside className="panel hidden min-h-0 border-y-0 border-r-0 lg:flex lg:flex-col"><div className="flex border-b border-[var(--line)]"><Tab active icon={<Clock3 size={15} />} text="历史" /><Tab icon={<BookOpen size={15} />} text="预设" /></div><div className="flex flex-1 flex-col items-center justify-center px-7 text-center"><Clock3 className="mb-4 text-[var(--muted)]" size={30} strokeWidth={1.4} /><b>还没有生成记录</b><p className="mt-2 text-xs leading-5 text-[var(--muted)]">最近 10 张图片会显示在这里，手动保存的作品最多保留 30 张。</p></div><div className="border-t border-[var(--line)] p-4"><div className="flex items-center justify-between text-xs"><span className="text-[var(--muted)]">NewAPI 余额</span><b>{authenticated ? (me?.user?.balance == null ? "读取中" : me.user.balance.toFixed(2)) : "体验模式"}</b></div><Link href="/sign-in" className="mt-3 flex h-9 items-center justify-center rounded-md bg-[#292d2c] text-xs font-semibold text-white">{authenticated ? `分组 · ${me?.user?.group || "读取中"}` : "登录使用真实余额"}</Link></div></aside>
    </div>
    {mobilePanel && <div className="fixed inset-0 z-40 bg-black/35 lg:hidden" onClick={() => setMobilePanel(false)}><aside className="panel flex h-full w-[min(90vw,330px)] flex-col" onClick={event => event.stopPropagation()}>{controls}</aside></div>}
  </main>;
}

function Control({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-[#4c5052]"><span className="mb-2 block">{label}</span>{children}</label>; }
function Prompt({ label, value, onChange, accent = false }: { label: string; value: string; onChange: (value: string) => void; accent?: boolean }) { return <label className={`rounded-md border bg-white p-3 ${accent ? "border-[#c99ba3]" : "border-[var(--line)]"}`}><span className="mb-2 flex items-center gap-2 text-xs font-semibold">{accent && <Sparkles size={13} className="text-[var(--rose)]" />}{label}</span><textarea value={value} onChange={event => onChange(event.target.value)} className="h-20 w-full resize-none text-sm leading-6 outline-none" /></label>; }
function Tab({ active, icon, text }: { active?: boolean; icon: React.ReactNode; text: string }) { return <button className={`flex h-12 flex-1 items-center justify-center gap-2 border-b-2 text-xs font-semibold ${active ? "border-[var(--rose)] text-[var(--rose)]" : "border-transparent text-[var(--muted)]"}`}>{icon}{text}</button>; }
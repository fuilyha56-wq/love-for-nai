"use client";

import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./onboarding-guide.css";

const GUIDE_KEY = "lfn-onboarding-v1";

type Step = { title: string; body: string; path: string; target?: string; action?: string };

const steps: Step[] = [
  { title: "选择创作来源", body: "图片工作台可选登录账号的 NewAPI 模型、自己导入的 OpenAI 兼容图像 API，或 NovelAI 官方 Key。自带来源的上游费用请在对应服务商核对；故事文本模型另在模型与密钥页管理。", path: "/settings#custom-providers", action: "管理图像来源" },
  { title: "登录与余额", body: "登录 NewAPI 账号后可查看余额、分组与可用模型。我的账号还提供签到、AFF、图包及邀请入口；确认费用后再提交生成。", path: "/account", target: ".workspace-page section > .grid article", action: "查看我的账号" },
  { title: "导入自己的图像来源", body: "在设置中填写 OpenAI 兼容图像 API 的地址、模型 ID 和 Key，或导入 NovelAI 官方 Key 并查看订阅信息。Key 保存在服务端，登录后可在图片工作台选择这些来源。", path: "/settings#custom-providers", target: "#custom-providers", action: "打开自定义 API" },
  { title: "图像模型与生成参数", body: "在图片工作台选择模型来源、图像模型、模式、分辨率、采样步数、相关性、种子和生成张数。NewAPI 来源显示预计费用；自带来源以对应服务商账单为准。", path: "/image", target: "[data-layout-module='model']", action: "打开图片工作台" },
  { title: "提示词与画布", body: "写下画面描述和排除内容，点击生成。结果在中央画布查看、下载，也可用作图生图、局部重绘或导演工具的输入。", path: "/image", target: "[data-layout-module='prompt']", action: "查看画布" },
  { title: "工具、参考图与标签助手", body: "左侧参考图片可选择图生图、局部重绘等模式；右侧查看本次历史、上传图片给标签助手识图并整理标签。标签助手的模型也使用 NewAPI 余额。", path: "/image", target: "[role='dialog'][aria-label='功能区'] [data-layout-module='agent'], .studio-tools-panel:not(.is-overlay) [data-layout-module='agent']", action: "查看工具区" },
  { title: "调整工作台", body: "从外观设置进入布局编辑器，在左右分区内拖动模块排序、切换显隐与调整栏宽。画布和生成按钮保持固定，保存后应用到图片工作台。", path: "/image/setting/layout", target: ".layout-editor-preview", action: "编辑布局" },
  { title: "故事工作台", body: "在 Storyteller 新建故事，设定类型和标签。文字冒险标为即将开放，暂不能使用。已有故事可从列表重新打开。", path: "/stories", target: ".story-mode-grid, .story-dashboard, .stories-auth-panel", action: "进入故事工作台" },
  { title: "故事编辑器", body: "创建并打开故事后，在正文中写作，选择可用模型执行续写、改写或插入；改写前需要先选中文本。可以建立分支，比较不同剧情，并在故事设置中调整信息。", path: "/stories", target: ".story-editor-shell, .story-dashboard, .stories-auth-panel", action: "打开故事列表" },
  { title: "历史与广场", body: "图片历史保存个人生成记录，广场浏览和分享作品；需要投稿时先检查图片内容与公开范围。", path: "/history", target: ".workspace-page > section", action: "查看图片历史" },
  { title: "发现作品", body: "在图片广场发现、查看作品；点击作品进入详情页。部分作品可能被默认遮罩，按页面提示查看。", path: "/gallery", target: ".workspace-page > section", action: "打开图片广场" },
  { title: "用量、账单与额度", body: "在使用记录核对每次调用及扣费；账号页查看 AFF、图包与 NewAPI 余额。自带第三方 API 的上游账单应在该服务商处核对。", path: "/usage", target: ".workspace-page > section", action: "查看使用记录" },
  { title: "对外 API 密钥", body: "模型与密钥页面还可创建 LFN 对外 API 密钥，供外部客户端调用 /ai 和 /v1；它不同于导入故事模型用的上游 Key，请妥善保管。", path: "/resources#api-tokens", target: "#api-tokens", action: "查看密钥" },
  { title: "外观、公告与帮助", body: "外观设置可调主题、背景和布局；公告查看站点变化；开发者文档记录接口鉴权与请求格式。管理功能仅向管理员显示。教程以后可通过右下角指南按钮重新打开。", path: "/settings", target: ".workspace-page > section > article", action: "查看外观设置" },
];

export function OnboardingGuide() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [source, setSource] = useState<"newapi" | "custom" | null>(null);
  const [resuming, setResuming] = useState(false);
  const [spotlight, setSpotlight] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (pathname === "/sign-in") return;
    const stored = window.localStorage.getItem(GUIDE_KEY);
    if (!stored) queueMicrotask(() => setOpen(true));
  }, [pathname]);

  useEffect(() => {
    if (!open || stepIndex === 0) return;
    const path = steps[stepIndex].path;
    if (pathname !== path.split(/[?#]/)[0] || (path.includes("?") && !window.location.search.includes("layoutEditor=1"))) {
      router.push(path);
    }
  }, [open, pathname, router, stepIndex]);

  useEffect(() => {
    if (!open && !resuming) return;
    const target = steps[stepIndex].target;
    if (!target) return;
    if (pathname !== steps[stepIndex].path.split(/[?#]/)[0]) return;
    let frame = 0;
    if (window.innerWidth < 1024 && pathname === "/image" && [3, 4, 5].includes(stepIndex)) {
      const label = stepIndex === 5 ? "功能区" : "图像设置";
      if (!document.querySelector(`[role="dialog"][aria-label="${label}"]`)) {
        [...document.querySelectorAll<HTMLButtonElement>('.studio-canvas button')].find((button) => button.textContent?.trim() === label && button.getBoundingClientRect().width > 0)?.click();
      }
    }
    const update = () => {
      const rect = [...document.querySelectorAll(target)].map((element) => element.getBoundingClientRect()).find((box) => box.width > 0 && box.height > 0 && box.left < window.innerWidth && box.top < window.innerHeight && box.right > 0 && box.bottom > 0);
      if (!rect) return setSpotlight(null);
      const top = Math.max(0, rect.top - 6);
      const left = Math.max(0, rect.left - 6);
      setSpotlight({ top, left, width: Math.min(window.innerWidth, rect.right + 6) - left, height: Math.min(window.innerHeight, rect.bottom + 6) - top });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const timer = window.setTimeout(() => {
      [...document.querySelectorAll(target)].find((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.left < window.innerWidth && box.right > 0; })?.scrollIntoView({ behavior: "smooth", block: "center" });
      schedule();
    }, 200);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [pathname, open, resuming, stepIndex]);

  const step = steps[stepIndex];
  const close = () => { window.localStorage.setItem(GUIDE_KEY, "done"); setOpen(false); setResuming(false); };
  const next = () => {
    if (stepIndex === steps.length - 1) return close();
    const nextStep = steps[stepIndex + 1];
    setSpotlight(null);
    setStepIndex(stepIndex + 1);
    if (pathname !== nextStep.path.split(/[?#]/)[0] || nextStep.path.includes("?")) router.push(nextStep.path);
  };
  const goToStep = () => {
    const path = stepIndex === 0 && source === "newapi" ? "/sign-in" : stepIndex === 0 ? "/settings#custom-providers" : step.path;
    setSpotlight(null);
    setResuming(true);
    setOpen(false);
    router.push(path);
  };

  if (pathname === "/sign-in") return null;
  return <>
    <button type="button" className="guide-launcher" onClick={() => { if (!resuming) setStepIndex(0); setOpen(true); }} aria-label={resuming ? "继续新手教程" : "打开新手教程"} title="新手教程"><Compass size={18} /><span>{resuming ? "继续指南" : "指南"}</span></button>
    {open && <div className={`guide-backdrop${spotlight ? " has-spotlight" : ""}`} role="presentation">
      {spotlight && <>
        <div className="guide-shade" aria-hidden="true" style={{ top: 0, left: 0, right: 0, height: spotlight.top }} />
        <div className="guide-shade" aria-hidden="true" style={{ top: spotlight.top, left: 0, width: spotlight.left, height: spotlight.height }} />
        <div className="guide-shade" aria-hidden="true" style={{ top: spotlight.top, left: spotlight.left + spotlight.width, right: 0, height: spotlight.height }} />
        <div className="guide-shade" aria-hidden="true" style={{ top: spotlight.top + spotlight.height, left: 0, right: 0, bottom: 0 }} />
        <div className="guide-spotlight" aria-hidden="true" style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }} />
      </>}
      <section className="guide-dialog" style={spotlight ? {
        position: "fixed",
        top: spotlight.top + spotlight.height + 12 + 340 < window.innerHeight ? spotlight.top + spotlight.height + 12 : Math.max(12, spotlight.top - 352),
        left: Math.min(Math.max(12, spotlight.left), Math.max(12, window.innerWidth - 572)),
      } : undefined} role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <div className="guide-topline"><span>LOVE FOR NAI / 新手导览</span><button type="button" onClick={close} aria-label="关闭新手教程"><X size={18} /></button></div>
        <div className="guide-progress" aria-label={`第 ${stepIndex + 1} 步，共 ${steps.length} 步`}><span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div>
        <div className="guide-content">
          <p className="guide-count">{String(stepIndex + 1).padStart(2, "0")} / {steps.length}</p>
          <h2 id="guide-title">{step.title}</h2>
          <p>{step.body}</p>
          {stepIndex === 0 && <div className="guide-sources" aria-label="选择创作来源">
            <button type="button" aria-pressed={source === "newapi"} onClick={() => setSource("newapi")}><b>使用 NewAPI 账号</b><small>图片与故事；登录后按账号权限和余额使用</small></button>
            <button type="button" aria-pressed={source === "custom"} onClick={() => setSource("custom")}><b>使用自带 API</b><small>OpenAI 兼容图像接口或 NovelAI Key，用于图片生成</small></button>
          </div>}
          {stepIndex === 0 && source && <p className="guide-choice">{source === "newapi" ? "下一步：登录账号并查看余额；图像工作台使用该账号。" : "下一步：前往设置导入图像 API 或 NovelAI Key，登录后即可选择。"}</p>}
          {step.target && pathname === step.path.split("?")[0].split("#")[0] && <button type="button" className="guide-locate" onClick={() => document.querySelector(step.target!)?.scrollIntoView({ behavior: "smooth", block: "center" })}>定位当前页面区域</button>}
        </div>
        <div className="guide-footer"><button type="button" disabled={stepIndex === 0} onClick={() => setStepIndex(stepIndex - 1)} aria-label="上一步"><ArrowLeft size={16} /></button><button type="button" disabled={stepIndex === 0 && !source} onClick={goToStep}>{stepIndex === 0 && source === "newapi" ? "前往登录" : step.action || "前往页面"}</button><button type="button" className="guide-next" onClick={next}>{stepIndex === steps.length - 1 ? "完成" : "下一步"}<ArrowRight size={16} /></button></div>
      </section>
    </div>}
  </>;
}

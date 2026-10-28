"use client";

import { ArrowLeft, ArrowRight, BookOpen, LocateFixed, Minimize2, Play, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { findFeatureTutorial, TUTORIAL_RETURN_URL, type TutorialStep } from "@/lib/feature-tutorials";
import { FEATURE_TUTORIAL_EVENT, finishFeatureTutorial, readTutorialSession, writeTutorialSession, type TutorialSession } from "@/lib/feature-tutorial-session";
import { setGuideActive } from "@/lib/guide-preferences";
import { setGuideActive as setMobileGuideActive } from "@/mobile/lib/guide-preferences";
import { findTutorialStepAction, findTutorialTarget, revealTutorialTarget } from "./tutorial-targets";
import { TutorialText } from "./tutorial-text";
import "./tutorials.css";

type Spotlight = { top: number; left: number; width: number; height: number };

export function FeatureTutorialGuide() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<TutorialSession | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  const [actionNeeded, setActionNeeded] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const tutorial = session ? findFeatureTutorial(session.tutorialId) : undefined;
  const step = tutorial && session ? tutorial.steps[session.stepIndex] : undefined;
  const nextStep = tutorial && session ? tutorial.steps[session.stepIndex + 1] : undefined;

  const navigate = useCallback((next: TutorialStep) => {
    const url = new URL(next.path, window.location.origin);
    // Keep the user's loaded editor draft when advancing within the editor.
    if (url.pathname === "/image/editor" && window.location.pathname === url.pathname) {
      if (new URLSearchParams(window.location.search).get("mode") === url.searchParams.get("mode")) return;
      const params = new URLSearchParams(window.location.search);
      params.set("mode", url.searchParams.get("mode") || "inpaint");
      router.push(`${url.pathname}?${params}`);
      return;
    }
    if (window.location.pathname !== url.pathname || (url.hash && window.location.hash !== url.hash) || (url.search && window.location.search !== url.search)) router.push(next.path);
  }, [router]);

  useEffect(() => {
    const restore = () => { setSession(readTutorialSession()); setCollapsed(false); setActionNeeded(""); setActionLabel(""); };
    restore();
    window.addEventListener(FEATURE_TUTORIAL_EVENT, restore);
    return () => window.removeEventListener(FEATURE_TUTORIAL_EVENT, restore);
  }, []);

  useEffect(() => {
    const active = Boolean(session);
    setGuideActive(active);
    setMobileGuideActive(active);
    document.documentElement.toggleAttribute("data-feature-tutorial", active);
    return () => { document.documentElement.removeAttribute("data-feature-tutorial"); };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const current = findFeatureTutorial(session.tutorialId)?.steps[session.stepIndex];
    if (current) navigate(current);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }, [session, navigate]);

  useEffect(() => {
    if (!step || pathname !== step.path.split(/[?#]/)[0]) return;
    let frame = 0;
    let disposed = false;
    let markedTarget: HTMLElement | null = null;
    const update = () => {
      if (disposed) return;
      const action = findTutorialStepAction(step, nextStep);
      setActionLabel(action?.label || "");
      const element = action?.element || findTutorialTarget(step, nextStep);
      if (!element) { markedTarget?.removeAttribute("data-feature-tutorial-target"); markedTarget = null; setSpotlight(null); return; }
      if (markedTarget !== element) {
        markedTarget?.removeAttribute("data-feature-tutorial-target");
        markedTarget = element;
        element.setAttribute("data-feature-tutorial-target", "true");
        if (action) {
          setActionNeeded("");
          element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        }
      }
      const rect = element.getBoundingClientRect();
      const top = Math.max(4, rect.top - 4);
      const left = Math.max(4, rect.left - 4);
      const width = Math.min(innerWidth - 4, rect.right + 4) - left;
      const height = Math.min(innerHeight - 4, rect.bottom + 4) - top;
      const next = width > 0 && height > 0 ? { top, left, width, height } : null;
      setSpotlight((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    // The page may still be streaming or loading its model catalog.
    const reveal = () => {
      revealTutorialTarget(step, nextStep);
      findTutorialTarget(step, nextStep)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      schedule();
    };
    const timers = [100, 450, 1200].map((delay) => window.setTimeout(reveal, delay));
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "inert", "open", "class", "style", "disabled", "data-tutorial-source-ready"] });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      observer.disconnect();
      markedTarget?.removeAttribute("data-feature-tutorial-target");
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [step, nextStep, pathname]);

  const leave = useCallback((completed: boolean) => {
    if (!session) return;
    finishFeatureTutorial(session, completed);
    setSpotlight(null);
    router.push(TUTORIAL_RETURN_URL);
  }, [router, session]);

  useEffect(() => {
    if (!session) return;
    const escape = (event: KeyboardEvent) => {
      // Let nested editors, menus and dialogs consume Escape first.
      if (event.key === "Escape" && !event.defaultPrevented && panel.current?.contains(event.target as Node)) {
        event.preventDefault();
        leave(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [session, leave]);

  if (!session || !tutorial || !step) return null;
  const onStepPage = pathname === step.path.split(/[?#]/)[0];
  const locate = () => {
    if (!onStepPage) navigate(step);
    else { revealTutorialTarget(step, nextStep); requestAnimationFrame(() => findTutorialTarget(step, nextStep)?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" })); }
  };
  const next = () => {
    if (nextStep?.path.startsWith("/image/editor") && window.location.pathname !== "/image/editor") {
      const action = findTutorialStepAction(step, nextStep);
      setActionNeeded(action ? `图片已上传。请点击页面中高亮的「${action.label}」，进入编辑器后再点「下一步」。` : "请先上传源图，然后点击高亮的编辑器入口；进入编辑器后再点「下一步」。");
      locate();
      return;
    }
    setSpotlight(null);
    if (session.stepIndex === tutorial.steps.length - 1) leave(true);
    else writeTutorialSession({ ...session, stepIndex: session.stepIndex + 1 });
  };
  const editorEntryStep = nextStep?.path.startsWith("/image/editor") && pathname === "/image";
  const editorEntryOpen = Boolean(step.path === "/image" && nextStep?.path.startsWith("/image/editor") && pathname.startsWith("/image/editor"));
  const editorMode = nextStep?.path.match(/[?&]mode=([^&]+)/)?.[1];
  const editorModeLabel = editorMode === "canvas" ? "无限画布" : editorMode === "inpaint" ? "局部重绘" : editorMode === "tiled-upscale" ? "分块超分" : "目标模式";
  // Once the user enters the editor, keep its top mode tabs clear so they can
  // switch from the mobile mask-editor entry to canvas/upscale modes.
  const mobileTargetLow = typeof window !== "undefined" && window.innerWidth <= 1023 && spotlight !== null && spotlight.top + spotlight.height / 2 > window.innerHeight * 0.52;
  const dockAtTop = !editorEntryOpen && (["generate", "result", "editor-actions", "source", "reference"].includes(step.area) || mobileTargetLow);

  return <div className="feature-tutorial-layer" data-testid="feature-tutorial">
    {!collapsed && onStepPage && spotlight && <><div className="feature-tutorial-spotlight" aria-hidden="true" style={spotlight} />{actionLabel && <div className="feature-tutorial-target-label" style={{ top: Math.max(4, spotlight.top - 34), left: spotlight.left }}>下一步：{actionLabel}</div>}</>}
    <section className={`feature-tutorial-panel${collapsed ? " is-collapsed" : ""}${dockAtTop ? " is-docked-top" : ""}`} ref={panel} role="region" aria-label={`${tutorial.title}手把手教程`}>
      <header><span><BookOpen size={16} />{collapsed ? tutorial.title : "手把手教程"} · {session.stepIndex + 1}/{tutorial.steps.length}</span><div><button type="button" aria-label={collapsed ? "展开教程说明" : "收起说明，继续操作"} onClick={() => { setCollapsed(!collapsed); setSpotlight(null); }}>{collapsed ? <Play size={16} /> : <Minimize2 size={16} />}</button></div></header>
      {!collapsed && <>
        <div className="feature-tutorial-progress" role="progressbar" aria-label="教程进度" aria-valuemin={1} aria-valuemax={tutorial.steps.length} aria-valuenow={session.stepIndex + 1}><span style={{ width: `${(session.stepIndex + 1) / tutorial.steps.length * 100}%` }} /></div>
        <div className="feature-tutorial-body"><p className="tutorial-eyebrow">{tutorial.title}</p><h2 ref={heading} tabIndex={-1}>{step.title}</h2>{session.stepIndex === 0 && <p className="feature-tutorial-preparation"><b>开始前：</b><TutorialText>{tutorial.preparation}</TutorialText></p>}<p><TutorialText keywords={step.keywords}>{step.body}</TutorialText></p>{step.tip && <aside><TutorialText keywords={step.keywords}>{step.tip}</TutorialText></aside>}{actionNeeded && <aside role="alert"><TutorialText>{actionNeeded}</TutorialText></aside>}<p className="feature-tutorial-status" role="status"><TutorialText>{editorEntryOpen ? `已进入编辑器。请在顶部确认「${editorModeLabel}」模式，再点下一步；也可以由教程切换到该模式。` : !onStepPage ? "可以先完成当前页面的操作，再定位本步骤。" : actionLabel ? `图片已上传。请点击高亮的「${actionLabel}」，进入后再点「下一步」。` : spotlight ? "已标出操作区域，可以直接操作页面。说明挡住内容时可收起。" : "操作区域尚未出现，请先完成前置操作、展开面板或选择支持此功能的模型。"}</TutorialText></p></div>
        {actionLabel && onStepPage && <button type="button" className="tutorial-step-action tutorial-primary" onClick={() => findTutorialStepAction(step, nextStep)?.element.click()}><ArrowRight size={16} />打开{actionLabel}</button>}
        <div className="feature-tutorial-locate"><button type="button" onClick={locate}><LocateFixed size={15} />{onStepPage ? "定位操作区域" : "前往本步骤页面"}</button><button type="button" onClick={() => { setCollapsed(true); setSpotlight(null); }}>收起说明，继续操作</button></div>
        <footer><button type="button" disabled={session.stepIndex === 0} onClick={() => { setSpotlight(null); writeTutorialSession({ ...session, stepIndex: session.stepIndex - 1 }); }}><ArrowLeft size={15} />上一步</button><button type="button" className="tutorial-primary" onClick={next}>{session.stepIndex === tutorial.steps.length - 1 ? "完成教程，返回教程中心" : editorEntryOpen ? "已进入编辑器，继续" : editorEntryStep ? "进入编辑器后，下一步" : "我已了解，下一步"}<ArrowRight size={15} /></button></footer>
      </>}
      <button type="button" className="feature-tutorial-exit" onClick={() => leave(false)}><X size={16} /><span>退出教程，返回个人资料的教程中心</span></button>
    </section>
  </div>;
}

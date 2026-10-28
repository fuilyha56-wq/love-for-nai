"use client";

import { ArrowLeft, BookOpen, Check, ChevronDown, Compass, Play, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { featureTutorials, findFeatureTutorial, tutorialCategories } from "@/lib/feature-tutorials";
import { readTutorialProgress, readTutorialResult, startFeatureTutorial, type TutorialResult } from "@/lib/feature-tutorial-session";
import { TutorialIllustration } from "./tutorial-illustration";
import { TutorialText } from "./tutorial-text";
import "./tutorials.css";

export function TutorialCenter({ ready = true }: { ready?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [reading, setReading] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<TutorialResult | null>(null);
  const root = useRef<HTMLElement>(null);
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    const restore = () => {
      setProgress(readTutorialProgress());
      setResult(readTutorialResult());
      if (window.location.hash === "#profile-tutorials") {
        setExpanded(true);
        if (!ready) return;
        const locate = () => {
          root.current?.scrollIntoView({ block: "start" });
          root.current?.focus({ preventScroll: true });
        };
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        frame = requestAnimationFrame(locate);
        // Wallet and profile cards can finish laying out after the hash is restored.
        timer = window.setTimeout(locate, 200);
      }
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => { window.removeEventListener("hashchange", restore); cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [ready]);

  const tutorial = reading ? findFeatureTutorial(reading) : undefined;
  const needle = query.trim().toLowerCase();
  const items = featureTutorials.filter((item) => (category === "全部" || item.category === category) && (!needle || `${item.title} ${item.summary} ${item.category}`.toLowerCase().includes(needle)));
  const returnedTutorial = result && findFeatureTutorial(result.tutorialId);

  function openReading(id: string) {
    setReading(id);
    requestAnimationFrame(() => { articleHeading.current?.scrollIntoView({ block: "start" }); articleHeading.current?.focus({ preventScroll: true }); });
  }

  return <section id="profile-tutorials" ref={root} tabIndex={-1} className="profile-section tutorial-center" aria-labelledby="tutorial-center-title">
    <header className="tutorial-center-heading"><span className="tutorial-center-icon"><Compass size={23} /></span><div><p className="tutorial-eyebrow">从这里，学会每一项功能</p><h2 id="tutorial-center-title">功能教程</h2><p>想先看懂，还是边做边学？每项功能都提供图文教程和手把手教程。</p></div></header>
    <button type="button" className="tutorial-expand" aria-expanded={expanded} aria-controls="tutorial-center-content" onClick={() => setExpanded(!expanded)}><BookOpen size={18} /><span>{expanded ? "收起教程目录" : "选择功能教程"}<small>{featureTutorials.length} 项功能 · 两种学习方式</small></span><ChevronDown size={19} className={expanded ? "is-open" : undefined} /></button>
    {expanded && <div id="tutorial-center-content">
      {returnedTutorial && <div className="tutorial-return-notice" role="status"><Check size={17} /><span>{result?.completed ? `已完成「${returnedTutorial.title}」，已回到教程中心。` : `已退出「${returnedTutorial.title}」，已回到教程中心。`}<small>可以重新练习，或选择下一项功能。</small></span></div>}
      {tutorial ? <article className="tutorial-article" aria-labelledby="tutorial-article-title">
        <div className="tutorial-article-toolbar"><button type="button" onClick={() => { setReading(null); requestAnimationFrame(() => listHeading.current?.focus()); }}><ArrowLeft size={16} />返回教程目录</button><button type="button" className="tutorial-primary" onClick={() => startFeatureTutorial(tutorial.id)}><Play size={15} />改用手把手教程</button></div>
        <p className="tutorial-eyebrow">{tutorial.category} / 图文教程</p><h3 id="tutorial-article-title" ref={articleHeading} tabIndex={-1}>{tutorial.title}</h3><p>{tutorial.summary}</p>
        <div className="tutorial-preparation"><b>开始前准备</b><p><TutorialText>{tutorial.preparation}</TutorialText></p></div>
        <nav className="tutorial-article-index" aria-label="本篇教程步骤">{tutorial.steps.map((step, index) => <a key={index} href={`#tutorial-${tutorial.id}-${index}`}>{index + 1}. {step.title}</a>)}</nav>
        {tutorial.steps.map((step, index) => <section key={index} id={`tutorial-${tutorial.id}-${index}`} className="tutorial-article-step"><h4><span>{String(index + 1).padStart(2, "0")}</span>{step.title}</h4><TutorialIllustration tutorial={tutorial} step={step} index={index} /><p><TutorialText keywords={step.keywords}>{step.body}</TutorialText></p>{step.tip && <aside><TutorialText keywords={step.keywords}>{step.tip}</TutorialText></aside>}</section>)}
        <button type="button" className="tutorial-primary" onClick={() => startFeatureTutorial(tutorial.id)}><Play size={16} />现在跟着做一遍</button>
      </article> : <>
        <h3 ref={listHeading} tabIndex={-1} className="tutorial-list-title">选择你想学习的功能</h3>
        <label className="tutorial-search"><Search size={18} /><input type="search" aria-label="搜索功能教程" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索生图、重绘、超分、参考图…" /></label>
        <div className="tutorial-categories" role="group" aria-label="教程分类">{["全部", ...tutorialCategories].map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <p className="tutorial-list-count" role="status">共 {items.length} 项教程</p>
        <div className="tutorial-card-grid">{items.map((item, index) => <article className="tutorial-card" key={item.id} data-tutorial-id={item.id}><div className="tutorial-card-top"><span>{item.category}</span>{progress[item.id] === true && <span className="tutorial-completed"><Check size={12} />已学习</span>}</div><h4><span>{String(index + 1).padStart(2, "0")}</span>{item.title}</h4><p>{item.summary}</p><small>{item.steps.length} 步</small><div className="tutorial-card-actions"><button type="button" onClick={() => openReading(item.id)} aria-label={`${item.title}：图文教程`}><BookOpen size={15} />图文教程</button><button type="button" className="tutorial-primary" onClick={() => startFeatureTutorial(item.id)} aria-label={`${item.title}：手把手教程`}><Play size={15} />手把手教程</button></div></article>)}</div>
        {items.length === 0 && <div className="tutorial-empty"><p>没有找到相关教程，试试其他关键词。</p><button type="button" onClick={() => { setQuery(""); setCategory("全部"); }}>显示全部教程</button></div>}
      </>}
    </div>}
  </section>;
}

"use client";
import { usePanelHistory } from "@/app/ui/use-panel-history";
import { lfnConfirm } from "@/mobile/ui/lfn-dialog";


import Link from "next/link";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  BookText,
  Bot,
  ChevronRight,
  Download,
  FilePlus2,
  GitBranch,
  ImagePlus,
  LoaderCircle,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type ChangeEvent,
} from "react";
import { PopupSelect } from "@/mobile/ui/popup-select";
import { useDialogFocus } from "@/mobile/ui/use-dialog-focus";
import { CollectionToolbar } from "@/mobile/ui/collection-workspace";
import type { Story, StoryModel, StoryPatch } from "@/lib/stories";
import type { StoryGenerationMode } from "@/lib/story-generation";
import "./stories.css";

type WorkspaceView = "dashboard" | "create" | "editor";
type SettingsTab = "story" | "advanced" | "settings";
type StoryModelOption = { id: string; label: string; source: string };

const compactQuery = "(max-width: 1099px)";
function subscribeCompact(listener: () => void) {
  const query = matchMedia(compactQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function StoryPanel({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(true, dialog);
  return createPortal(<div className="stories-shell story-overlay" onClick={close} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); } }}>
    <section className="story-panel-surface" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <header className="story-panel-heading"><h2>{title}</h2><button type="button" aria-label={`关闭${title}`} onClick={close}><X size={20} /></button></header>
      {children}
    </section>
  </div>, document.body);
}

type JsonResult = {
  items?: Story[];
  story?: Story;
  content?: string;
  generated?: string;
  message?: string;
};

const generationActions: Array<{
  mode: StoryGenerationMode;
  label: string;
  detail: string;
}> = [
  { mode: "continue", label: "续写", detail: "从当前正文结尾自然延续" },
  { mode: "rewrite", label: "改写选区", detail: "重写编辑器中选中的片段" },
  { mode: "insert", label: "插入文本", detail: "在当前光标位置补充正文" },
];

async function readJson(response: Response): Promise<JsonResult> {
  const result = (await response.json().catch(() => ({}))) as JsonResult;
  if (!response.ok) throw new Error(result.message || `请求失败 (${response.status})`);
  return result;
}

function storyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="story-toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true"><i /></span>
      <b>{label}</b>
    </button>
  );
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="story-icon-button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function StoriesWorkspace({
  userName,
  authenticated,
}: {
  userName: string;
  authenticated: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<WorkspaceView>("dashboard");
  usePanelHistory("lfnStoryPage", view === "dashboard" ? null : view, next => setView(next === "create" || next === "editor" ? next : "dashboard"));
  const [stories, setStories] = useState<Story[]>([]);
  const [models, setModels] = useState<StoryModelOption[]>([]);
  const [modelWarning, setModelWarning] = useState("");
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(authenticated);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<SettingsTab>("story");
  const [storyListOpen, setStoryListOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const compact = useSyncExternalStore(subscribeCompact, () => matchMedia(compactQuery).matches, () => true);
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [tags, setTags] = useState("");
  const [instruction, setInstruction] = useState("");
  const [generationMode, setGenerationMode] = useState<StoryGenerationMode>("continue");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [editorWidth, setEditorWidth] = useState<"narrow" | "normal" | "wide">("normal");
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.9);
  const [focusMode, setFocusMode] = useState(true);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const pendingSaves = useRef(new Map<string, { storyId: string; branchId: string; content: string; timer: ReturnType<typeof setTimeout> }>());

  const activeBranch = activeStory?.branches.find(
    (branch) => branch.id === activeStory.activeBranchId,
  ) ?? null;

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const stage = stageRef.current;
    if (view !== "editor" || !editor || !stage) return;
    const resize = () => {
      editor.style.height = "0px";
      editor.style.height = `${Math.max(editor.scrollHeight, stage.clientHeight - 32)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [view, activeBranch?.content, editorWidth, fontSize, lineHeight]);

  const loadStories = useEffectEvent(async () => {
    if (!authenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await readJson(await fetch("/api/stories", { cache: "no-store" }));
      setStories(result.items || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取故事失败");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadStories(), 0);
    const pending = pendingSaves.current;
    return () => {
      window.clearTimeout(loadTimer);
      for (const draft of pending.values()) {
        clearTimeout(draft.timer);
        void fetch(`/api/stories/${draft.storyId}`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch: { id: draft.branchId, content: draft.content } }) }).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    void fetch("/api/stories/models", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { items?: StoryModelOption[]; warning?: string; message?: string };
        if (!response.ok) throw new Error(result.message || "读取模型失败");
        setModels(result.items || []);
        setModelWarning(result.warning || "");
      }).catch((cause) => { if (cause.name !== "AbortError") setModelWarning(cause.message); });
    return () => controller.abort();
  }, [authenticated]);

  function replaceStory(story: Story, select = false) {
    const merged = { ...story, branches: story.branches.map(branch => {
      const pending = pendingSaves.current.get(`${story.id}/${branch.id}`);
      return pending ? { ...branch, content: pending.content } : branch;
    }) };
    setActiveStory(current => select || !current || current.id === story.id ? merged : current);
    setStories((current) => {
      const rest = current.filter((item) => item.id !== story.id);
      return [merged, ...rest];
    });
  }

  async function savePatch(patch: StoryPatch, silent = false): Promise<Story | null> {
    if (!activeStory) return null;
    try {
      const result = await readJson(await fetch(`/api/stories/${activeStory.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }));
      if (result.story) replaceStory(result.story);
      if (!silent) setMessage("已保存");
      return result.story || null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
      return null;
    }
  }

  function queueContentSave(content: string) {
    if (!activeStory || !activeBranch) return;
    setActiveStory({
      ...activeStory,
      branches: activeStory.branches.map((branch) =>
        branch.id === activeBranch.id ? { ...branch, content } : branch,
      ),
    });
    const storyId = activeStory.id;
    const branchId = activeBranch.id;
    const key = `${storyId}/${branchId}`;
    const pending = pendingSaves.current.get(key);
    if (pending) clearTimeout(pending.timer);
    const timer = setTimeout(async () => {
      try {
        const result = await readJson(await fetch(`/api/stories/${storyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch: { id: branchId, content } }),
        }));
        if (pendingSaves.current.get(key)?.content === content) pendingSaves.current.delete(key);
        const saved = result.story;
        const merge = (current: Story) => {
          if (!saved || current.id !== storyId) return current;
          const savedBranch = saved.branches.find(branch => branch.id === branchId);
          return { ...current, updatedAt: saved.updatedAt, branches: current.branches.map(branch => branch.id === branchId && branch.content === content && savedBranch ? savedBranch : branch) };
        };
        setActiveStory(current => current ? merge(current) : current);
        setStories(current => current.map(merge));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "自动保存失败");
      }
    }, 700);
    pendingSaves.current.set(key, { storyId, branchId, content, timer });
    setStories(current => current.map(story => story.id === storyId ? { ...story, branches: story.branches.map(branch => branch.id === branchId ? { ...branch, content } : branch) } : story));
  }

  async function createStory() {
    setBusy(true);
    setError("");
    try {
      const result = await readJson(await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim() || "新故事",
          genre: [genre, tags].filter(Boolean).join(" · "),
          model: "sol",
          specializedPrompt: true,
        }),
      }));
      if (!result.story) throw new Error("创建故事后未收到故事数据");
      replaceStory(result.story, true);
      setStoryListOpen(false);
      setDrawerOpen(false);
      setView("editor");
      setMessage("故事已创建");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建故事失败");
    } finally {
      setBusy(false);
    }
  }

  function openStory(story: Story) {
    setActiveStory(current => current?.id === story.id ? current : story);
    setView("editor");
    setStoryListOpen(false);
    setDrawerOpen(false);
    setBranchMenuOpen(false);
    setError("");
  }

  async function generate() {
    if (!activeStory || !activeBranch || busy) return;
    const textarea = editorRef.current;
    const nextSelection = textarea
      ? { start: textarea.selectionStart, end: textarea.selectionEnd }
      : selection;
    if (generationMode === "rewrite" && nextSelection.start === nextSelection.end) {
      setError("改写前请先在正文中选择一段文本");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await readJson(await fetch(`/api/stories/${activeStory.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: activeBranch.id,
          mode: generationMode,
          instruction,
          content: activeBranch.content,
          selectionStart: nextSelection.start,
          selectionEnd: nextSelection.end,
        }),
      }));
      if (!result.story) throw new Error("生成完成，但未收到更新后的故事");
      replaceStory(result.story);
      setInstruction("");
      setMessage(`${generationActions.find((item) => item.mode === generationMode)?.label}完成`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function createBranch() {
    if (!activeStory || !activeBranch) return;
    setBusy(true);
    setError("");
    try {
      const result = await readJson(await fetch(`/api/stories/${activeStory.id}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceBranchId: activeBranch.id,
          name: `分支 ${activeStory.branches.length}`,
        }),
      }));
      if (!result.story) throw new Error("分支创建失败");
      replaceStory(result.story);
      setBranchMenuOpen(false);
      setMessage("已从当前正文创建分支");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建分支失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteActiveStory() {
    if (!activeStory || !(await lfnConfirm(`确定删除《${activeStory.title}》吗？此操作无法撤销。`))) return;
    setBusy(true);
    try {
      for (const [key, draft] of pendingSaves.current) if (draft.storyId === activeStory.id) { clearTimeout(draft.timer); pendingSaves.current.delete(key); }
      await readJson(await fetch(`/api/stories/${activeStory.id}`, { method: "DELETE" }));
      const nextStories = stories.filter((story) => story.id !== activeStory.id);
      setStories(nextStories);
      setActiveStory(null);
      setView("dashboard");
      setMessage("故事已删除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  function downloadStory() {
    if (!activeStory || !activeBranch) return;
    const blob = new Blob([activeBranch.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeStory.title}-${activeBranch.name}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function sendSceneToImage() {
    if (!activeBranch) return;
    const selected = activeBranch.content.slice(selection.start, selection.end).trim();
    const fallback = activeBranch.content.slice(-600).trim();
    const prompt = selected || fallback;
    router.push(`/image?prompt=${encodeURIComponent(prompt)}`);
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then(async (content) => {
      const result = await readJson(await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name.replace(/\.[^.]+$/, "") || "导入故事" }),
      }));
      if (!result.story) throw new Error("导入故事失败");
      const branch = result.story.branches[0];
      const saved = await readJson(await fetch(`/api/stories/${result.story.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: { id: branch.id, content } }),
      }));
      if (saved.story) openStory(saved.story);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "导入失败"));
    event.target.value = "";
  }

  if (!authenticated) {
    return (
      <main className="stories-shell stories-auth-wall">
        <div className="stories-auth-panel">
          <span className="stories-brand-mark"><BookOpen size={27} /></span>
          <p>LOVE FOR NAI / STORIES</p>
          <h1>登录后开始写作</h1>
          <p>故事、分支与世界设定会保存在你的账户下。</p>
            <Link href="/sign-in?next=/stories">前往登录 <ChevronRight size={17} /></Link>
            <Link href="/image" className="story-auth-back">返回图片工作台</Link>
        </div>
      </main>
    );
  }

  if (view === "create") {
    return <main className="stories-shell story-create-screen">
      <header className="story-form-toolbar"><button type="button" onClick={() => setView("dashboard")}><ArrowLeft size={20} />返回故事列表</button><h1>新建故事</h1></header>
      <form className="story-create-form" onSubmit={event => { event.preventDefault(); void createStory(); }}>
        <h2>故事信息</h2><p>填写创作方向，之后仍可在故事设置中修改。</p>
        <label><span>故事标题</span><input value={newTitle} onChange={event => setNewTitle(event.target.value)} maxLength={120} placeholder="新故事" autoFocus /></label>
        <label><span>类型</span><input value={genre} onChange={event => setGenre(event.target.value)} placeholder="例如：奇幻、悬疑、恋爱" /></label>
        <label><span>标签</span><input value={tags} onChange={event => setTags(event.target.value)} placeholder="例如：魔法、成长、公路故事" /></label>
        <fieldset className="story-suggestions"><legend>写作方向</legend>{["奇幻旅途", "都市谜案", "太空歌剧"].map((item, index) => <button key={item} type="button" aria-pressed={genre === item} onClick={() => { setGenre(item); setTags(index === 0 ? "魔法, 成长" : index === 1 ? "悬疑, 群像" : "星际, 冒险"); }}>{item}</button>)}</fieldset>
        {error && <p role="alert" className="story-status-error">{error}</p>}
        <div className="story-form-actions"><button type="button" onClick={() => setView("dashboard")}>取消</button><button type="submit" className="story-primary-button" disabled={busy}>{busy ? <LoaderCircle className="story-spin" size={18} /> : <WandSparkles size={18} />}创建故事</button></div>
      </form>
    </main>;
  }

  if (view === "editor" && activeStory && activeBranch) {
    const modelLabel = models.find((item) => item.id === activeStory.model)?.label || activeStory.model;
    const settingsContent = <>
          <div className="story-settings-tabs" role="tablist" aria-label="故事设置">
            {([
              ["story", "故事", BookText],
              ["advanced", "高级", SlidersHorizontal],
              ["settings", "设置", Settings],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" role="tab" aria-selected={drawerTab === value} onClick={() => setDrawerTab(value)}>
                <Icon size={16} /><span>{label}</span>
              </button>
            ))}
            <button
              type="button"
              className="story-settings-close" hidden={compact}
              aria-label="收起设置"
              title="收起设置"
              onClick={() => setDrawerOpen(false)}
            >
              <PanelRightClose size={18} />
            </button>
          </div>
          <div className="story-settings-scroll">
            {drawerTab === "story" && (
              <>
                <div className="story-setting-section">
                  <span className="story-setting-label">故事模式</span>
                  <div className="story-mode-value"><BookText size={18} /><b>Storyteller</b></div>
                </div>
                <div className="story-setting-section">
                  <span className="story-setting-label">AI 模型 <small>选择已配置的文本模型</small></span>
                  <PopupSelect
                    value={activeStory.model}
                    options={[
                      ...(!models.some((item) => item.id === activeStory.model)
                        ? [{ value: activeStory.model, label: activeStory.model, description: "当前不可用" }]
                        : []),
                      ...models.map((item) => ({
                        value: item.id,
                        label: item.label,
                        description: item.source,
                      })),
                    ]}
                    onChange={(next) => void savePatch({ model: next as StoryModel })}
                    ariaLabel="故事 AI 模型"
                    searchable
                    searchPlaceholder="搜索模型"
                    emptyText="没有匹配的模型"
                  />
                  <p>{modelLabel}。可在模型与密钥中添加自己的文本模型。</p>
                  {modelWarning && <p role="status">{modelWarning}</p>}
                  <Link href="/settings#story-providers">管理模型源</Link>
                </div>
                <div className="story-setting-section">
                  <Toggle checked={activeStory.specializedPrompt} onChange={(specializedPrompt) => void savePatch({ specializedPrompt })} label="小说特化提示词" />
                  <p>保持人物、视角和设定连续。关闭后只保留最简写作指令。</p>
                </div>
                <div className="story-setting-section">
                  <label className="story-setting-label" htmlFor="story-genre">类型与标签</label>
                  <input id="story-genre" value={activeStory.genre} onChange={(event) => setActiveStory({ ...activeStory, genre: event.target.value })} onBlur={(event) => void savePatch({ genre: event.target.value })} placeholder="奇幻 · 成长 · 群像" />
                </div>
                <div className="story-setting-section">
                  <label className="story-setting-label" htmlFor="story-synopsis">Memory / 故事概要</label>
                  <textarea id="story-synopsis" value={activeStory.synopsis} onChange={(event) => setActiveStory({ ...activeStory, synopsis: event.target.value })} onBlur={(event) => void savePatch({ synopsis: event.target.value })} placeholder="记录长期有效的情节、人物关系和写作方向。" />
                  <small>{activeStory.synopsis.length.toLocaleString("zh-CN")} / 4,000</small>
                </div>
                <div className="story-setting-section">
                  <label className="story-setting-label" htmlFor="story-lorebook">Lorebook / 世界设定</label>
                  <textarea id="story-lorebook" className="story-lorebook-input" value={activeStory.lorebook} onChange={(event) => setActiveStory({ ...activeStory, lorebook: event.target.value })} onBlur={(event) => void savePatch({ lorebook: event.target.value })} placeholder="地点、角色、阵营、规则与专有名词。" />
                  <small>{activeStory.lorebook.length.toLocaleString("zh-CN")} / 20,000</small>
                </div>
              </>
            )}
            {drawerTab === "advanced" && (
              <>
                <div className="story-setting-heading"><Bot size={18} /><span><b>生成行为</b><small>模型参数由 LFN 为小说写作优化</small></span></div>
                <div className="story-setting-section story-readonly-setting"><span>并发上限</span><b>2</b><small>超过两路的请求会自动排队</small></div>
                <div className="story-setting-section story-readonly-setting"><span>上下文窗口</span><b>60,000 字符</b><small>优先保留故事末尾的最近内容</small></div>
                <div className="story-setting-section story-readonly-setting"><span>单次生成</span><b>最多 1,800 tokens</b><small>由当前选择的文本模型根据上下文续写</small></div>
                <div className="story-setting-section">
                  <label className="story-setting-label" htmlFor="generation-instruction">默认写作方向</label>
                  <textarea id="generation-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：增加对话，让冲突逐渐升级。" />
                  <p>它会同步到底部生成栏，便于在写作时快速调整。</p>
                </div>
              </>
            )}
            {drawerTab === "settings" && (
              <>
                <div className="story-setting-heading"><PanelRightOpen size={18} /><span><b>编辑器</b><small>只影响当前设备上的阅读体验</small></span></div>
                <div className="story-setting-section">
                  <span className="story-setting-label">正文宽度</span>
                  <div className="story-segmented">
                    {(["narrow", "normal", "wide"] as const).map((value) => (
                      <button key={value} type="button" aria-pressed={editorWidth === value} onClick={() => setEditorWidth(value)}>
                        {value === "narrow" ? "窄" : value === "normal" ? "标准" : "宽"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="story-setting-section">
                  <label className="story-range-label" htmlFor="story-font-size"><span>字号</span><b>{fontSize}px</b></label>
                  <input id="story-font-size" type="range" min="15" max="24" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} />
                </div>
                <div className="story-setting-section">
                  <label className="story-range-label" htmlFor="story-line-height"><span>行距</span><b>{lineHeight.toFixed(1)}</b></label>
                  <input id="story-line-height" type="range" min="1.5" max="2.4" step="0.1" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} />
                </div>
                <div className="story-setting-section"><Toggle checked={focusMode} onChange={setFocusMode} label="专注模式" /><p>默认隐藏低频设置，只保留正文与生成操作。</p></div>
                <div className="story-setting-section story-file-actions">
                  <button type="button" onClick={downloadStory}><Download size={17} /> 导出当前分支</button>
                  <button type="button" onClick={() => void savePatch({})}><Save size={17} /> 立即保存</button>
                  <button type="button" className="story-danger-button" onClick={() => void deleteActiveStory()}><Trash2 size={17} /> 删除故事</button>
                </div>
              </>
            )}
          </div>
    </>;
    return (
      <main className={`stories-shell story-editor-shell story-editor-${editorWidth}`} data-focus-mode={focusMode}>
        <div className="story-editor-workspace" inert={storyListOpen || branchMenuOpen || (compact && drawerOpen)}>
        <header className="story-editor-header">
          <div className="story-editor-nav">
            <IconButton label="打开故事列表" active={storyListOpen} onClick={() => setStoryListOpen((open) => !open)}>
              <Menu size={20} />
            </IconButton>
            <button type="button" className="stories-brand-mark" aria-label="返回故事首页" onClick={() => setView("dashboard")}>
              <BookOpen size={20} />
            </button>
          </div>
          <input
            className="story-title-input"
            value={activeStory.title}
            aria-label="故事标题"
            onChange={(event) => setActiveStory({ ...activeStory, title: event.target.value })}
            onBlur={(event) => void savePatch({ title: event.target.value })}
          />
          <div className="story-editor-actions">
            <IconButton label="管理故事分支" active={branchMenuOpen} onClick={() => setBranchMenuOpen(true)}><GitBranch size={19} /></IconButton>
            <IconButton label={drawerOpen ? "收起设置" : "打开设置"} active={drawerOpen} onClick={() => setDrawerOpen((open) => !open)}>
              {drawerOpen ? <PanelRightClose size={20} /> : <Settings size={20} />}
            </IconButton>
          </div>
        </header>

        <section ref={stageRef} className="story-writing-stage">
          <textarea
            ref={editorRef}
            className="story-prose-editor"
            value={activeBranch.content}
            style={{ fontSize: `${fontSize}px`, lineHeight }}
            placeholder="在这里写下故事的开头……"
            spellCheck={false}
            aria-label="故事正文"
            onChange={(event) => queueContentSave(event.target.value)}
            onSelect={(event) => setSelection({
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            })}
          />
        </section>

        <footer className="story-generation-dock">
          {(message || error) && (
            <div className={error ? "story-status story-status-error" : "story-status"}>
              <span>{error || message}</span>
              <button type="button" onClick={() => { setError(""); setMessage(""); }} aria-label="关闭提示"><X size={15} /></button>
            </div>
          )}
          <div className="story-instruction-row">
            <BookOpen size={18} aria-hidden="true" />
            <input
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void generate();
              }}
              placeholder="告诉模型接下来发生什么；留空则延续当前情节"
              aria-label="本次生成指令"
            />
          </div>
          <div className="story-dock-toolbar">
            <div className="story-dock-secondary">
              <IconButton label="再次生成" disabled={!activeBranch.content || busy} onClick={() => void generate()}><RefreshCw size={18} /></IconButton>
              <IconButton label="将选中场景带到图片工作台" disabled={!activeBranch.content} onClick={sendSceneToImage}><ImagePlus size={18} /></IconButton>
              <span className="story-word-count">{activeBranch.content.length.toLocaleString("zh-CN")} 字</span>
            </div>
            <div className="story-generate-group">
              <PopupSelect value={generationMode} ariaLabel="故事生成方式" menuMinWidth={240} options={generationActions.map(action => ({ value: action.mode, label: action.label, description: action.detail }))} onChange={value => setGenerationMode(value as StoryGenerationMode)} />
              <button type="button" className="story-send-button" aria-label={busy ? "正在生成故事" : "生成故事"} disabled={busy} onClick={() => void generate()}>
                {busy ? <LoaderCircle className="story-spin" size={19} /> : <Send size={18} />}
                <span>{busy ? "生成中" : "发送"}</span>
              </button>
            </div>
          </div>
        </footer>

        </div>
        {!compact && drawerOpen && <aside className="story-settings-drawer is-open" aria-label="故事设置">{settingsContent}</aside>}
        {compact && drawerOpen && <StoryPanel title="故事设置" close={() => setDrawerOpen(false)}>{settingsContent}</StoryPanel>}
        {storyListOpen && <StoryPanel title="故事列表" close={() => setStoryListOpen(false)}><div className="story-library-content">
          <button type="button" className="story-library-new" onClick={() => { setStoryListOpen(false); setView("create"); }}><Plus size={17} />新建故事</button>
          <div className="story-library-items">{stories.map(story => <button key={story.id} type="button" aria-current={story.id === activeStory.id ? "page" : undefined} onClick={() => openStory(story)}><BookText size={18} /><span><b>{story.title}</b><small>{storyDate(story.updatedAt)}</small></span></button>)}</div>
        </div></StoryPanel>}
        {branchMenuOpen && <StoryPanel title="故事分支" close={() => setBranchMenuOpen(false)}><div className="story-library-content">
          <button type="button" className="story-library-new" onClick={() => void createBranch()} disabled={busy}><Plus size={17} />从当前正文创建分支</button>
          {activeStory.branches.map(branch => <button type="button" className="story-branch-option" aria-current={branch.id === activeStory.activeBranchId ? "true" : undefined} key={branch.id} onClick={() => { void savePatch({ activeBranchId: branch.id }); setBranchMenuOpen(false); }}><span><b>{branch.name}</b><small>{branch.parentId ? "从其他分支创建" : "主线起点"}</small></span>{branch.id === activeStory.activeBranchId && <i>当前</i>}</button>)}
        </div></StoryPanel>}

      </main>
    );
  }

  return (
    <main className="stories-shell story-dashboard">
      <CollectionToolbar title="故事工作台" icon={<BookText size={21} />} count={stories.length} query={query} onQueryChange={setQuery} searchPlaceholder="搜索故事标题、类型…" actions={<div className="launcher-story-actions"><button type="button" onClick={() => setView("create")}><Plus size={18} />新故事</button><label><Upload size={18} />导入<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={importFile} /></label></div>} />
      <section className="story-dashboard-content">
        <p className="story-owner">{userName} 的故事</p>
        {error && <div className="story-dashboard-error">{error}<button type="button" onClick={() => setError("")}><X size={15} /></button></div>}
        {loading ? (
          <div className="story-dashboard-loading"><LoaderCircle className="story-spin" size={25} /> 正在读取你的故事</div>
        ) : stories.length ? (
          <div className="story-grid">
            {stories.filter(story => `${story.title} ${story.genre}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((story) => (
              <button type="button" key={story.id} className="story-dashboard-card" onClick={() => openStory(story)}>
                <span className="story-card-icon"><BookText size={22} /></span>
                <span><b>{story.title}</b><small>上次编辑：{storyDate(story.updatedAt)}</small></span>
                <span className="story-card-meta"><i>{story.model.toUpperCase()}</i><i>{story.branches.length} 个分支</i></span>
                <ChevronRight size={20} />
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="story-empty-state" onClick={() => setView("create")}>
            <FilePlus2 size={29} />
            <span><b>创建你的第一个故事</b><small>填写故事信息，开始书写。</small></span>
            <ChevronRight size={19} />
          </button>
        )}
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/mobile/ui/use-dialog-focus";
import { CollectionToolbar } from "@/mobile/ui/collection-workspace";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Brush, GitBranch, History, ImageIcon, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { lfnConfirm, lfnPrompt } from "@/mobile/ui/lfn-dialog";
import { PopupSelect } from "@/mobile/ui/popup-select";
import {
  createEditorHistoryBranch, deleteEditorHistoryProject, editorHistoryBranchNodes, editorHistoryEditHref,
  editorHistoryResultOperation, EDITOR_HISTORY_OPERATION_LABELS, filterEditorHistoryProjects,
  listEditorHistoryProjects, loadEditorHistoryNode, renameEditorHistoryBranch, renameEditorHistoryNode,
  renameEditorHistoryProject, type EditorHistoryNode, type EditorHistoryProject,
} from "@/lib/image-editor-history";
import { deleteEditorDraft } from "@/lib/image-editor-store";
import { ImageDownloadMenu } from "@/mobile/image-download-menu";
import { editorHistoryImageBlob, importLegacyEditorHistory } from "@/lib/image-editor-record";
import "./history.css";

const ROOT = "/image/editor/history";
const PARAMETER_LABELS: Record<string, string> = { model: "模型", width: "生成宽度", height: "生成高度", steps: "步数", scale: "CFG", strength: "重绘强度", sampler: "采样器", noiseSchedule: "噪声调度", quality: "质量", imageSize: "分辨率档位", background: "背景" };
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function href(projectId: string, branchId = "", nodeId = "") {
  const params = new URLSearchParams({ draftId: projectId });
  if (branchId) params.set("branchId", branchId);
  if (nodeId) params.set("nodeId", nodeId);
  return `${ROOT}?${params}`;
}
function nodeDepth(node: EditorHistoryNode, byId: Map<string, EditorHistoryNode>) {
  const visited = new Set([node.id]);
  let parent = node.parentId; let depth = 0;
  while (parent && depth < 7 && !visited.has(parent)) {
    visited.add(parent); depth += 1; parent = byId.get(parent)?.parentId || null;
  }
  return Math.min(depth, 7);
}

export default function HistoryLibrary() {
  const router = useRouter();
  const params = useSearchParams();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationDialog = useRef<HTMLDivElement>(null);
  useDialogFocus(navigationOpen, navigationDialog);
  const [projects, setProjects] = useState<EditorHistoryProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState("all");
  const [nodeQuery, setNodeQuery] = useState("");
  const [nodeLimit, setNodeLimit] = useState({ key: "", count: 100 });
  const [preview, setPreview] = useState<{ id: string; url: string; width: number; height: number } | null>(null);
  const [previewError, setPreviewError] = useState<{ id: string; message: string } | null>(null);
  const projectId = params.get("draftId") || "";
  const branchId = params.get("branchId") || "";
  const project = projects.find((item) => item.id === projectId);
  const branch = project?.branches.find((item) => item.id === branchId);
  const selectedNode = project?.nodes.find((node) => node.id === params.get("nodeId"))
    || project?.nodes.find((node) => node.id === branch?.headId) || project?.latestResult;
  const selectedNodeId = selectedNode?.id || "";
  const refresh = useCallback(async () => setProjects(await listEditorHistoryProjects()), []);
  useEffect(() => {
    let active = true;
    void (async () => {
      let migrationMessage = "";
      try {
        const failures = await importLegacyEditorHistory();
        if (failures) migrationMessage = `${failures} 条旧图片记录暂时无法读取，已有重绘作品仍可正常浏览。`;
      } catch { migrationMessage = "旧版图片历史暂时无法迁入；下方仍会显示已保存的重绘作品。"; }
      const items = await listEditorHistoryProjects();
      if (active) {
        setProjects(items);
        if (migrationMessage) setMessage(migrationMessage);
      }
    })().catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "读取本地重绘历史失败"); })
      .finally(() => { if (active) setLoading(false); });
    const onFocus = () => { void refresh().catch((error) => { if (active) setMessage(String(error)); }); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("lfn-editor-history-changed", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); window.removeEventListener("lfn-editor-history-changed", onFocus); };
  }, [refresh]);
  useEffect(() => {
    if (!selectedNodeId) return;
    let active = true; let objectUrl = "";
    void (async () => {
      const node = await loadEditorHistoryNode(selectedNodeId);
      if (!node) throw new Error("这个历史节点已不存在");
      const blob = await editorHistoryImageBlob(node.image);
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setPreview({ id: node.id, url: objectUrl, width: node.image.width, height: node.image.height });
      setPreviewError(null);
    })().catch((error) => { if (active) setPreviewError({ id: selectedNodeId, message: error instanceof Error ? error.message : "图片读取失败" }); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedNodeId]);

  const visibleProjects = useMemo(() => filterEditorHistoryProjects(projects, query, operation), [projects, query, operation]);
  const branchNodes = project ? editorHistoryBranchNodes(project, branchId) : [];
  const visibleNodes = branchNodes.filter((node) => !nodeQuery.trim() || [node.label, node.document.prompt || "", node.document.generation?.model || "", project?.branches.find((entry) => entry.id === node.branchId)?.name || ""].some((text) => text.toLocaleLowerCase().includes(nodeQuery.trim().toLocaleLowerCase())));
  const nodeMap = new Map(project?.nodes.map((node) => [node.id, node]) || []);
  const nodeListKey = `${projectId}:${branchId}:${nodeQuery}`;
  const shownNodeCount = nodeLimit.key === nodeListKey ? nodeLimit.count : 100;
  const activePreview = preview?.id === selectedNodeId ? preview : null;
  const mutate = async (action: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await action(); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  };
  const renameProject = async () => {
    if (!project) return;
    const name = await lfnPrompt("为这张图像的重绘作品命名。", project.name, { title: "重命名作品" });
    if (name?.trim()) await mutate(() => renameEditorHistoryProject(project.id, name));
  };
  const renameBranch = async () => {
    if (!branch) return;
    const name = await lfnPrompt("为当前分支命名。", branch.name, { title: "重命名分支" });
    if (name?.trim()) await mutate(async () => { await renameEditorHistoryBranch(branch.id, name); });
  };
  const renameNode = async () => {
    if (!selectedNode) return;
    const name = await lfnPrompt("为这个图像节点命名。", selectedNode.label, { title: "重命名节点" });
    if (name?.trim()) await mutate(async () => { await renameEditorHistoryNode(selectedNode.id, name); });
  };
  const fork = async (edit: boolean) => {
    if (!project || !selectedNode) return;
    const name = await lfnPrompt("新分支从当前选中的图像节点开始，已有分支会保留。", `分支 ${project.branches.length + 1}`, { title: "从此节点新建分支" });
    if (!name?.trim()) return;
    await mutate(async () => {
      const created = await createEditorHistoryBranch(project.id, name, selectedNode.id);
      router.push(edit ? editorHistoryEditHref(selectedNode, created.id) : href(project.id, created.id, selectedNode.id));
    });
  };
  const remove = async () => {
    if (!project || !await lfnConfirm(`删除「${project.name}」的全部本地重绘历史、分支和节点？此操作无法撤销。`)) return;
    await mutate(async () => { await deleteEditorHistoryProject(project.id); await deleteEditorDraft(project.id); router.replace(ROOT); });
  };

  const versionNavigation = project && <><aside className="redraw-branch-panel"><h2><GitBranch size={16} />版本分支</h2><button className={`redraw-branch${!branchId ? " is-active" : ""}`} onClick={() => router.replace(href(project.id), { scroll: false })}><History size={16} /><span><strong>全部分支</strong><small>{project.nodes.length} 个节点</small></span></button>{project.branches.map((entry) => { const head = project.nodes.find((node) => node.id === entry.headId); return <button key={entry.id} className={`redraw-branch${entry.id === branchId ? " is-active" : ""}`} onClick={() => router.replace(href(project.id, entry.id, entry.headId), { scroll: false })}>{head && <Image unoptimized src={head.thumbnail} alt="" width={36} height={42} />}<span><strong>{entry.name}</strong><small>{editorHistoryBranchNodes(project, entry.id).filter((node) => editorHistoryResultOperation(node)).length} 张操作结果</small></span></button>; })}<button className="redraw-new-branch" disabled={busy || !selectedNode} onClick={() => void fork(false)}><Plus size={15} />从选中节点新建分支</button>{branch && <button className="redraw-new-branch" disabled={busy} onClick={() => void renameBranch()}><Pencil size={14} />重命名当前分支</button>}<p className="redraw-local-note">图片、蒙版、参数和分支都保存在此浏览器本地。返回旧节点继续修改时，会保留已有版本。</p></aside>
        <section className="redraw-node-panel"><div className="redraw-node-heading"><h2>历史节点 <small>{branch ? branch.name : "全部分支"}</small></h2><label className="redraw-search"><Search size={15} /><input aria-label="搜索当前作品节点" placeholder="查找节点、图像和提示词" value={nodeQuery} onChange={(event) => setNodeQuery(event.target.value)} /></label></div><div className="redraw-node-tree" role="tree" aria-label="作品分支历史树">{[...visibleNodes].reverse().slice(0, shownNodeCount).map((node) => { const resultOperation = editorHistoryResultOperation(node); const nodeBranch = project.branches.find((entry) => entry.id === node.branchId); return <button type="button" role="treeitem" aria-selected={selectedNodeId === node.id} className={`redraw-history-node${selectedNodeId === node.id ? " is-selected" : ""}`} style={{ "--node-depth": nodeDepth(node, nodeMap) } as CSSProperties} key={node.id} onClick={() => router.replace(href(project.id, branchId, node.id), { scroll: false })}><span className="redraw-tree-dot" /><Image unoptimized src={node.thumbnail} alt="" width={46} height={52} /><span><strong>{node.label}</strong><small>{nodeBranch?.name} · {date(node.createdAt)}</small><em>{resultOperation ? EDITOR_HISTORY_OPERATION_LABELS[resultOperation] : node.parentId ? "编辑保存点" : "初始源图"}{project.branches.some((entry) => entry.headId === node.id) ? " · HEAD" : ""}</em></span></button>; })}{!visibleNodes.length && <p className="redraw-local-note">没有匹配的节点。</p>}{visibleNodes.length > shownNodeCount && <button className="redraw-more" onClick={() => setNodeLimit({ key: nodeListKey, count: shownNodeCount + 100 })}>显示更多节点（{shownNodeCount}/{visibleNodes.length}）</button>}</div></section></>;

  return <main className="redraw-history-page" inert={navigationOpen}>
    {project ? <header className="redraw-history-topbar"><span><Brush size={20} /><strong>重绘历史</strong></span><Link href={ROOT} className="redraw-history-back"><ArrowLeft size={17} />全部作品</Link></header> : <CollectionToolbar title="重绘历史" icon={<Brush size={21} />} count={projects.length} query={query} onQueryChange={setQuery} searchPlaceholder="搜索作品、分支、模型或提示词"><PopupSelect ariaLabel="按重绘操作筛选" value={operation} onChange={setOperation} options={[{ value: "all", label: "全部操作" }, ...Object.entries(EDITOR_HISTORY_OPERATION_LABELS).map(([value, label]) => ({ value, label }))]} /></CollectionToolbar>}
    <div className="redraw-history-content">
      {project && <div className="redraw-history-heading"><div><p className="redraw-eyebrow">IMAGE EDIT HISTORY</p><h1>{project ? project.name : "每次重绘，都有迹可循。"}</h1><p>{project ? `${project.results.length} 张操作结果 · ${project.branches.length} 个分支 · ${project.nodes.length} 个历史节点` : "浏览局部重绘、无限画布和超分作品，沿着分支找回每一个版本。"}</p></div>{project && <div className="redraw-toolbar"><button className="redraw-mobile-navigation-button" onClick={() => setNavigationOpen(true)}><GitBranch size={16} />版本与历史</button><button disabled={busy} onClick={() => void renameProject()}><Pencil size={15} />命名作品</button><button className="redraw-danger" disabled={busy} onClick={() => void remove()} aria-label="删除当前重绘作品"><Trash2 size={15} /></button></div>}</div>}
      {message && <p className="redraw-message" role="status">{message}</p>}
      {loading ? <div className="redraw-empty"><Loader2 className="redraw-spin" size={26} /><p>正在整理本地重绘作品和分支…</p></div> : !project ? <>
        {projectId && <p className="redraw-message">此作品尚未产生重绘结果，或记录已被删除。下方显示其他已完成操作的作品。</p>}
        <div className="redraw-history-summary"><span><ImageIcon size={17} /><b>{projects.length}</b> 件作品</span><span><GitBranch size={17} /><b>{projects.reduce((total, item) => total + item.branches.length, 0)}</b> 个分支</span><span><History size={17} /><b>{projects.reduce((total, item) => total + item.results.length, 0)}</b> 张操作结果</span></div>

        {visibleProjects.length ? <div className="redraw-project-grid">{visibleProjects.map((item) => <Link className="redraw-project-card" href={href(item.id)} key={item.id}><div className="redraw-project-image"><Image unoptimized src={item.latestResult.thumbnail} alt={item.name} fill sizes="320px" /><span>{item.results.length} 张结果</span></div><div className="redraw-project-copy"><strong>{item.name}<ArrowUpRight size={16} /></strong><div className="redraw-operation-tags">{item.operations.map((key) => <span key={key}>{EDITOR_HISTORY_OPERATION_LABELS[key]}</span>)}</div><p><GitBranch size={13} />{item.branches.map((entry) => entry.name).join(" / ")}</p><small>{date(item.updatedAt)} · {item.nodes.length} 个节点</small></div></Link>)}</div> : <div className="redraw-empty"><History size={34} /><h2>{query || operation !== "all" ? "没有匹配的重绘作品" : "还没有重绘作品"}</h2><p>成功完成局部重绘、无限画布或超分后，图片与分支会自动保存在这里。</p><Link href="/image">前往图像工作台<ArrowUpRight size={15} /></Link></div>}
      </> : <div className="redraw-project-detail">
        <div className="redraw-project-navigation">{versionNavigation}</div>
        <section className="redraw-preview-panel">{selectedNode && <><div className="redraw-preview-toolbar"><div><strong>{selectedNode.label}</strong><small>{project.branches.find((entry) => entry.id === (branchId || selectedNode.branchId))?.name} · {date(selectedNode.createdAt)}</small></div><button title="重命名节点" aria-label="重命名选中节点" disabled={busy} onClick={() => void renameNode()}><Pencil size={16} /></button></div><div className="redraw-preview-image">{activePreview ? <Image unoptimized src={activePreview.url} alt={selectedNode.label} width={activePreview.width} height={activePreview.height} /> : previewError?.id === selectedNodeId ? <p role="status">{previewError.message}</p> : <Loader2 className="redraw-spin" size={28} />}</div><div className="redraw-preview-actions"><Link className="redraw-primary" href={editorHistoryEditHref(selectedNode, branchId || selectedNode.branchId)}><Brush size={16} />从此节点继续编辑</Link><button disabled={busy} onClick={() => void fork(true)}><GitBranch size={15} />新分支并编辑</button>{activePreview && <ImageDownloadMenu src={activePreview.url} filename={`${project.name.replace(/[\\/:*?"<>|]/g, "-")}-${selectedNode.id.slice(-6)}`} className="redraw-download-menu" label="下载图片" title="选择图片下载方式" />}</div><div className="redraw-node-metadata"><span>{activePreview ? `${activePreview.width} × ${activePreview.height}` : ""}</span><span>{selectedNode.document.generation?.model}</span></div><details className="redraw-node-parameters"><summary>提示词与生成参数</summary><p>{selectedNode.document.prompt || "未填写提示词"}</p><p className="redraw-negative">{selectedNode.document.negativePrompt || "未填写排除内容"}</p><dl>{Object.entries(selectedNode.document.generation || {}).filter(([key, value]) => key in PARAMETER_LABELS && value != null).map(([key, value]) => <div key={key}><dt>{PARAMETER_LABELS[key]}</dt><dd>{String(value)}</dd></div>)}</dl></details></>}</section>
      </div>}
    </div>
    {navigationOpen && typeof document !== "undefined" && createPortal(<div className="redraw-navigation-backdrop" onClick={() => setNavigationOpen(false)} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); setNavigationOpen(false); } }}><div ref={navigationDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="版本与历史" className="redraw-navigation-dialog" onClick={event => event.stopPropagation()}><header><b>版本与历史</b><button type="button" aria-label="关闭版本与历史" onClick={() => setNavigationOpen(false)}><X size={20} /></button></header><div className="redraw-navigation-content" onClick={event => { if (event.target instanceof Element && event.target.closest(".redraw-branch,.redraw-history-node")) setNavigationOpen(false); }}>{versionNavigation}</div></div></div>, document.body)}
  </main>;
}

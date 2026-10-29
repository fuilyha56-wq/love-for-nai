"use client";

import { type ComicProject, type ComicCandidate } from "./comic-project";

type RecordValue = { owner: string; project: ComicProject };
const DATABASE = "lfn-comic-projects-v1";
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: ["owner", "project.id"] });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error("无法打开本机分镜库，请检查浏览器存储权限。")); };
    request.onblocked = () => { database = undefined; reject(new Error("请关闭其他旧版分镜页面后重试。")); };
  }).catch(() => { database = undefined; throw new Error("无法打开本机分镜库，请检查浏览器存储权限。"); });
  return database;
}
function notify(owner: string) { window.dispatchEvent(new CustomEvent("lfn-comic-updated", { detail: owner })); if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("lfn-comic-updates"); channel.postMessage(owner); channel.close(); } }
export async function listComicProjects(owner: string): Promise<ComicProject[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const tx = db.transaction("projects", "readonly"); const request = tx.objectStore("projects").getAll(IDBKeyRange.bound([owner, ""], [owner, "\uffff"])); tx.oncomplete = () => resolve((request.result as RecordValue[]).map((item) => item.project).sort((a, b) => b.updatedAt - a.updatedAt)); tx.onerror = () => reject(new Error("无法读取分镜库。")); });
}
export async function mutateComicProject(owner: string, id: string, mutate: (project: ComicProject | undefined) => ComicProject | null): Promise<ComicProject | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite"), store = tx.objectStore("projects"), request = store.get([owner, id]);
    let result: ComicProject | null = null;
    request.onsuccess = () => { try { result = mutate((request.result as RecordValue | undefined)?.project); if (result) store.put({ owner, project: result }); else store.delete([owner, id]); } catch { tx.abort(); } };
    tx.oncomplete = () => { notify(owner); resolve(result); };
    tx.onerror = tx.onabort = () => reject(new Error("分镜保存失败，请检查本机存储空间。"));
  });
}
export async function saveComicProject(owner: string, project: ComicProject) {
  return mutateComicProject(owner, project.id, (previous) => ({ ...project, updatedAt: Date.now(), panels: project.panels.map((panel) => {
    const prior = previous?.panels.find((item) => item.id === panel.id);
    const all = new Map([...(prior?.candidates ?? []), ...panel.candidates].map((candidate) => [candidate.id, candidate]));
    const removedCandidateIds = [...new Set([...(prior?.removedCandidateIds ?? []), ...(panel.removedCandidateIds ?? [])])];
    const candidates = Array.from(all.values()).filter((item) => !removedCandidateIds.includes(item.id)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(-10);
    return { ...panel, candidates, removedCandidateIds, selectedId: candidates.some((item) => item.id === panel.selectedId) ? panel.selectedId : candidates.at(-1)?.id ?? null };
  }) }));
}
export async function appendComicCandidates(owner: string, projectId: string, panelId: string, candidates: ComicCandidate[]) {
  return mutateComicProject(owner, projectId, (project) => {
    if (!project) throw new Error("分镜项目已被删除。");
    if (!project.panels.some((item) => item.id === panelId)) throw new Error("该分镜已被移除。");
    return { ...project, updatedAt: Date.now(), panels: project.panels.map((panel) => {
      if (panel.id !== panelId) return panel;
      const merged = Array.from(new Map([...panel.candidates, ...candidates].map((item) => [item.id, item])).values()).filter((item) => !panel.removedCandidateIds?.includes(item.id)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const kept = merged.filter((item, index) => merged.findIndex((other) => other.image === item.image && other.prompt === item.prompt) === index).slice(-10);
      const preferred = candidates.at(-1)?.id ?? panel.selectedId;
      return { ...panel, candidates: kept, selectedId: kept.some((item) => item.id === preferred) ? preferred : kept.some((item) => item.id === panel.selectedId) ? panel.selectedId : kept.at(-1)?.id ?? null };
    }) };
  });
}

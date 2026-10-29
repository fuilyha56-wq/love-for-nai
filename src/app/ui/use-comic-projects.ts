"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createComicProject, type ComicProject } from "@/lib/comic-project";
import { listComicProjects, mutateComicProject, saveComicProject } from "@/lib/client-comic-projects";

export function useComicProjects(owner: string) {
  const [projects, setProjects] = useState<ComicProject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [loadedOwner, setLoadedOwner] = useState(owner);
  const revision = useRef(0), pending = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWrites = useRef(0);
  const refresh = useCallback(async () => { if (pendingWrites.current > 0) return; const token = ++revision.current; try { const items = await listComicProjects(owner); if (token === revision.current && pendingWrites.current === 0) { setProjects(items); setLoadedOwner(owner); setError(""); setReady(true); } } catch (failure) { if (token === revision.current) { setProjects([]); setLoadedOwner(owner); setError(failure instanceof Error ? failure.message : "无法读取分镜。"); setReady(true); } } }, [owner]);
  useEffect(() => {
    void Promise.resolve().then(() => { setActiveId(null); return refresh(); }); const focus = () => void refresh(); const event = (value: Event) => { if ((value as CustomEvent).detail === owner) void refresh(); };
    window.addEventListener("focus", focus); window.addEventListener("lfn-comic-updated", event);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("lfn-comic-updates"); if (channel) channel.onmessage = (message) => { if (message.data === owner) void refresh(); };
    return () => { revision.current++; window.removeEventListener("focus", focus); window.removeEventListener("lfn-comic-updated", event); channel?.close(); };
  }, [owner, refresh]);
  const save = useCallback((project: ComicProject) => {
    setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
    pendingWrites.current++;
    pending.current = pending.current.catch(() => {}).then(() => saveComicProject(owner, project)).then((result) => { pendingWrites.current--; if (!pendingWrites.current) void refresh(); return result; }, (failure) => { pendingWrites.current--; setError(failure instanceof Error ? failure.message : "保存失败。"); throw failure; });
    void pending.current.catch(() => {});
    return pending.current;
  }, [owner, refresh]);
  const create = useCallback(async () => { if (projects.length >= 32) { setError("本机最多保存 32 个分镜项目，请先导出并删除旧项目。"); return; } const project = createComicProject(); setActiveId(project.id); try { await save(project); } catch { /* Save reports its storage error. */ } }, [projects.length, save]);
  const remove = useCallback(async (id: string) => { try { await pending.current; await mutateComicProject(owner, id, () => null); setActiveId((value) => value === id ? null : value); await refresh(); } catch (failure) { setError(failure instanceof Error ? failure.message : "删除失败。"); } }, [owner, refresh]);
  const visibleProjects = loadedOwner === owner ? projects : [];
  return { projects: visibleProjects, activeId: activeId ?? visibleProjects[0]?.id ?? null, setActiveId, active: visibleProjects.find((item) => item.id === (activeId ?? visibleProjects[0]?.id)) ?? null, save, create, remove, ready: ready && loadedOwner === owner, error: loadedOwner === owner ? error : "", setError, flush: () => pending.current };
}

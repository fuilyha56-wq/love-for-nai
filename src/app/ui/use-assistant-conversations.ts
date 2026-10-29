"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAssistantConversationId, type AssistantConversationSession } from "@/lib/assistant-conversation-types";

export type AssistantConversationControl = {
  activeId: string;
  sessions: AssistantConversationSession[];
  pending: boolean;
  error: string;
  select: (id: string) => void;
  create: (title: string) => Promise<void>;
  rename: (title: string) => Promise<void>;
  remove: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useAssistantConversations(signedIn: boolean) {
  const [activeId, setActiveId] = useState("default");
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [identityRevision, setIdentityRevision] = useState(0);
  const [sessions, setSessions] = useState<AssistantConversationSession[]>([]);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const active = useRef("default"), ownerKey = useRef<string | null>(null);
  const loading = useRef<AbortController | null>(null);
  const controllers = useRef(new Set<AbortController>()), pendingTokens = useRef(new Set<symbol>());
  const generation = useRef(0), selectionRevision = useRef(0), mounted = useRef(true);

  const begin = useCallback((controller: AbortController) => {
    const token = Symbol(); controllers.current.add(controller); pendingTokens.current.add(token);
    if (mounted.current) setPending(true);
    return token;
  }, []);
  const end = useCallback((controller: AbortController, token: symbol) => {
    controllers.current.delete(controller); pendingTokens.current.delete(token);
    if (mounted.current) setPending(pendingTokens.current.size > 0);
  }, []);
  const commit = useCallback((id: string) => {
    active.current = id; setActiveId(id);
    try { if (ownerKey.current) localStorage.setItem(ownerKey.current, id); } catch { /* Selection remains usable without browser storage. */ }
  }, []);
  const getActiveId = useCallback(() => active.current, []);
  const getIdentityToken = useCallback(() => generation.current, []);

  const refresh = useCallback(async (preferred?: string) => {
    loading.current?.abort();
    const controller = new AbortController(); loading.current = controller;
    const token = begin(controller), epoch = generation.current, revision = selectionRevision.current;
    setError("");
    try {
      const response = await fetch("/api/assistant/conversations", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const result = await response.json();
      if (controller.signal.aborted || epoch !== generation.current || !mounted.current) return;
      if (!response.ok) {
        if (response.status === 401) {
          generation.current++; ownerKey.current = null; active.current = "default";
          setActiveId("default"); setSessions([]); setOwnerId(null); setIdentityRevision((value) => value + 1);
          for (const other of controllers.current) if (other !== controller) other.abort();
        }
        throw new Error(result.message || "无法读取助手会话");
      }
      const list: AssistantConversationSession[] = Array.isArray(result.sessions) ? result.sessions.filter((item: unknown): item is AssistantConversationSession => {
        if (!item || typeof item !== "object") return false;
        const entry = item as Partial<AssistantConversationSession>;
        return isAssistantConversationId(entry.id) && typeof entry.title === "string" && typeof entry.createdAt === "string" && typeof entry.updatedAt === "string";
      }) : [];
      if (!list.some((item) => item.id === "default")) throw new Error("助手会话目录暂不可用，仍可使用默认会话。");
      let next = preferred && revision === selectionRevision.current ? preferred : active.current;
      if (Number.isSafeInteger(result.ownerId) && result.ownerId > 0) {
        const key = `lfn-assistant-conversation-${result.ownerId}`;
        if (ownerKey.current !== key) {
          const switchingOwner = ownerKey.current !== null;
          ownerKey.current = key; next = "default";
          try { const saved = localStorage.getItem(key); if (saved && isAssistantConversationId(saved)) next = saved; } catch { /* New identities start at default. */ }
          if (switchingOwner) {
            generation.current++; setIdentityRevision((value) => value + 1);
            for (const other of controllers.current) if (other !== controller) other.abort();
          }
          setOwnerId(result.ownerId);
        }
      }
      setSessions(list);
      commit(list.some((item) => item.id === next) ? next : "default");
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && (epoch === generation.current || (error instanceof Error && /登录|session/i.test(error.message)))) setError(error instanceof Error ? error.message : "会话读取失败");
    } finally { if (loading.current === controller) loading.current = null; end(controller, token); }
  }, [begin, commit, end]);

  useEffect(() => {
    const generationRef = generation;
    const effectControllers = controllers.current;
    const effectPendingTokens = pendingTokens.current;
    mounted.current = true;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      if (signedIn) void refresh();
      else { generation.current++; ownerKey.current = null; active.current = "default"; setActiveId("default"); setSessions([]); setOwnerId(null); setPending(false); setError(""); }
    });
    return () => {
      alive = false; mounted.current = false; generationRef.current++;
      for (const controller of effectControllers) controller.abort();
      effectControllers.clear(); effectPendingTokens.clear();
    };
  }, [signedIn, refresh]);

  const mutate = useCallback(async (method: "POST" | "PATCH" | "DELETE", title?: string) => {
    const controller = new AbortController(), token = begin(controller);
    const epoch = generation.current, revision = selectionRevision.current, targetId = active.current;
    setError("");
    try {
      const response = await fetch(method === "DELETE" ? `/api/assistant/conversations?id=${encodeURIComponent(targetId)}` : "/api/assistant/conversations", {
        method, headers: { "Content-Type": "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        ...(method === "DELETE" ? {} : { body: JSON.stringify({ ...(method === "PATCH" ? { id: targetId } : {}), title }) }),
      });
      const result = await response.json();
      if (controller.signal.aborted || epoch !== generation.current || !mounted.current) return;
      if (!response.ok) throw new Error(result.message || "会话操作失败");
      if (method === "DELETE") {
        if (targetId !== "default") setSessions((items) => items.filter((item) => item.id !== targetId));
        if (active.current === targetId) commit("default");
        setIdentityRevision((value) => value + 1);
      } else if (isAssistantConversationId(result.session?.id) && typeof result.session.title === "string") {
        const entry = result.session as AssistantConversationSession;
        setSessions((items) => [...items.filter((item) => item.id !== entry.id), entry]);
        if (method === "POST" && revision === selectionRevision.current) commit(entry.id);
      }
      await refresh();
    } catch (error) {
      if (controller.signal.aborted || epoch !== generation.current || !mounted.current) return;
      setError(error instanceof Error ? error.message : "会话操作失败"); throw error;
    } finally { end(controller, token); }
  }, [begin, commit, end, refresh]);

  const control: AssistantConversationControl = {
    activeId, sessions, pending, error,
    select: (id) => { if (sessions.some((item) => item.id === id)) { selectionRevision.current++; commit(id); } },
    create: (title) => mutate("POST", title), rename: (title) => mutate("PATCH", title), remove: () => mutate("DELETE"), refresh: () => refresh(),
  };
  return { activeId, ownerId, identityRevision, getActiveId, getIdentityToken, control };
}

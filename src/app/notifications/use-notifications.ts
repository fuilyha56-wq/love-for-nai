"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserNotification } from "@/lib/notifications";

const UPDATED = "lfn-notifications-updated";

/** Read state always comes from the account on the server, never device storage. */
export function useNotifications(limit = 100) {
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [marking, setMarking] = useState(false);
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const mounted = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => {
    if (writing.current || !mounted.current) return;
    const request = ++sequence.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const response = await fetch(`/api/notifications?limit=${limit}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || request !== sequence.current) return;
      if (response.status === 401) { setSignedIn(false); setItems([]); setUnreadCount(0); return; }
      const result = await response.json();
      if (controller.signal.aborted || request !== sequence.current) return;
      if (!response.ok) throw new Error(result.message || "消息读取失败");
      setSignedIn(true);
      setItems(Array.isArray(result.items) ? result.items : []);
      setUnreadCount(Math.max(0, Number(result.unreadCount) || 0));
      setMessage("");
    } catch (error) {
      if (!controller.signal.aborted && request === sequence.current) setMessage(error instanceof Error ? error.message : "消息读取失败，请重试。");
    } finally {
      if (!controller.signal.aborted && request === sequence.current) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(refresh);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onUpdate = () => void refresh();
    const timer = window.setInterval(onVisible, 5_000);
    window.addEventListener("focus", onUpdate);
    window.addEventListener("pageshow", onUpdate);
    window.addEventListener(UPDATED, onUpdate);
    document.addEventListener("visibilitychange", onVisible);
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel.current = new BroadcastChannel(UPDATED);
        channel.current.onmessage = onUpdate;
      } catch { /* Restricted browsers still synchronize with the server on focus and polling. */ }
    }
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onUpdate);
      window.removeEventListener("pageshow", onUpdate);
      window.removeEventListener(UPDATED, onUpdate);
      document.removeEventListener("visibilitychange", onVisible);
      channel.current?.close();
      channel.current = null;
    };
  }, [refresh]);

  const markRead = useCallback(async (id?: string) => {
    if (writing.current) return false;
    writing.current = true;
    ++sequence.current;
    activeRequest.current?.abort();
    setMarking(true);
    setMessage("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "标记已读失败，请重试。");
      if (mounted.current) {
        setItems(current => current.map(item => !id || item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item));
        setUnreadCount(Math.max(0, Number(result.unreadCount) || 0));
      }
      window.dispatchEvent(new Event(UPDATED));
      channel.current?.postMessage("refresh");
      return true;
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "标记已读失败，请重试。");
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setMarking(false);
    }
  }, []);

  return { items, unreadCount, loading, signedIn, message, marking, refresh, markRead };
}

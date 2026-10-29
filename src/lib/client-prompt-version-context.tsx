"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { clientUuid } from "@/lib/client-uuid";
import { recentPromptVersions, recordPromptVersion, type PromptVersion, type PromptVersionTarget } from "@/lib/prompt-versions";
export type VersionContext = { versions: PromptVersion[]; restore: (target: PromptVersionTarget, text: string) => void };
const Context = createContext<VersionContext | null>(null);

/** Local to this browser tab; prompts are never uploaded by the version history. */
export function PromptVersionProvider({ prompt, negative, scope, onRestore, children }: {
  prompt: string; negative: string; scope: string; onRestore: VersionContext["restore"]; children: ReactNode;
}) {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const history = useRef<PromptVersion[]>([]);
  const initialized = useRef("");
  const storageKey = `lfn-prompt-versions:${scope}`;
  useEffect(() => {
    if (initialized.current !== storageKey) {
      initialized.current = storageKey;
      try { history.current = recentPromptVersions(JSON.parse(sessionStorage.getItem(storageKey) || "[]"), Date.now()); }
      catch { history.current = []; }
    }
    const now = Date.now();
    history.current = recordPromptVersion(history.current, "prompt", prompt, now, clientUuid());
    history.current = recordPromptVersion(history.current, "negative", negative, now, clientUuid());
    const next = history.current;
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Memory history remains available. */ }
    void Promise.resolve().then(() => setVersions(next));
  }, [prompt, negative, storageKey]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = recentPromptVersions(history.current, Date.now());
      if (next.length === history.current.length) return;
      history.current = next;
      setVersions(next);
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage can be unavailable. */ }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [storageKey]);
  return <Context.Provider value={{ versions, restore: onRestore }}>{children}</Context.Provider>;
}


export function usePromptVersionContext() { return useContext(Context); }

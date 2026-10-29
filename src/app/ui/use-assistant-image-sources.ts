"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { assistantImageSourceFile, type AssistantImageSource } from "@/lib/assistant-image-resource";

export function useAssistantImageSources(scope: string, onFiles: (files: File[]) => Promise<void>, onError: (message: string) => void) {
  const current = useRef({ scope, onFiles, onError });
  useLayoutEffect(() => { current.current = { scope, onFiles, onError }; }, [scope, onFiles, onError]);
  const controllers = useRef(new Set<AbortController>()), epoch = useRef(0);
  const [pending, setPending] = useState({ scope, count: 0 });
  const cancel = useCallback((publish = true) => { epoch.current++; for (const controller of controllers.current) controller.abort(); controllers.current.clear(); if (publish) setPending({ scope: current.current.scope, count: 0 }); }, []);
  useEffect(() => () => cancel(false), [scope, cancel]);
  const addSources = useCallback(async (sources: readonly AssistantImageSource[]) => {
    if (!sources.length) return;
    const capturedScope = current.current.scope, capturedEpoch = epoch.current;
    const controller = new AbortController(); controllers.current.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
    setPending({ scope: capturedScope, count: controllers.current.size });
    try {
      for (const source of sources.slice(0, 10)) {
        signal.throwIfAborted();
        const file = await assistantImageSourceFile(source, signal);
        if (current.current.scope !== capturedScope || epoch.current !== capturedEpoch) return;
        await current.current.onFiles([file]);
      }
    } catch (error) { if (!controller.signal.aborted && current.current.scope === capturedScope && epoch.current === capturedEpoch) current.current.onError(error instanceof Error ? error.message : "参考图导入失败。"); }
    finally { controllers.current.delete(controller); if (current.current.scope === capturedScope && epoch.current === capturedEpoch) setPending({ scope: capturedScope, count: controllers.current.size }); }
  }, []);
  return { addSources, cancel, loading: pending.scope === scope && pending.count > 0 };
}

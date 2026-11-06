"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  isPromptCompletionQuery, loadPromptCompletionWordlist, matchLocalPromptTags,
  mergePromptCompletions, normalizePromptCompletionQuery, type PromptCompletion,
} from "@/lib/prompt-completion";
import { autocompleteTagTranslation, matchBundledTagTranslations } from "@/lib/tag-translations";
import { promptTagText } from "@/lib/prompt-tag";

type Field = HTMLInputElement | HTMLTextAreaElement;
type LibraryEntry = { name: string; content: string };
const remoteCache = new Map<string, { hits: PromptCompletion[]; expiresAt: number }>();

export function usePromptSuggestions(autocomplete: boolean, library: LibraryEntry[], readToken: (field: Field) => string, maximum = 10) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<PromptCompletion[]>([]);
  const [active, setActive] = useState(0);
  const request = useRef<{ field: Field; query: string; controller: AbortController; timer?: number } | null>(null);
  const composing = useRef(false);
  const compositionFrame = useRef(0);

  function cancelPending() {
    cancelAnimationFrame(compositionFrame.current);
    const pending = request.current;
    request.current = null;
    if (pending) {
      window.clearTimeout(pending.timer);
      pending.controller.abort();
    }
  }

  useEffect(() => cancelPending, [autocomplete]);

  function display(hits: PromptCompletion[]) {
    setSuggestions(hits);
    setActive(0);
  }

  function dismiss() {
    cancelPending();
    display([]);
  }

  function search(field: Field) {
    if (composing.current || document.activeElement !== field) return;
    const token = readToken(field).trim();
    const alias = token.startsWith("<");
    const query = alias ? token.toLowerCase() : normalizePromptCompletionQuery(token);
    if (request.current?.query === query && request.current.field === field) return;
    dismiss();
    if (!autocomplete || (!alias && (!isPromptCompletionQuery(query) || /[{}\[\]<>]|::/.test(query)))) return;

    const pending: NonNullable<typeof request.current> = { field, query, controller: new AbortController() };
    request.current = pending;
    if (alias) {
      display(library.filter((entry) => entry.name.trim() && entry.name.toLowerCase().includes(query.slice(1))).slice(0, maximum)
        .map((entry) => ({ name: `<${entry.name}>`, displayName: entry.name, categoryName: "我的词库", zh: entry.content, local: true })));
      return;
    }

    const cached = remoteCache.get(query);
    let remote = cached && cached.expiresAt > Date.now() ? cached.hits : [];
    const translated: PromptCompletion[] = matchBundledTagTranslations(query, maximum)
      .map((hit) => ({ ...hit, displayName: promptTagText(hit.name), categoryName: "本地词表", local: true }));
    const libraryTags = library.flatMap((entry) => entry.content.split(/[,，\n]/));
    let local: PromptCompletion[] = [];
    function publish() {
      if (request.current !== pending || document.activeElement !== field || normalizePromptCompletionQuery(readToken(field)) !== query) return;
      const hits = mergePromptCompletions(query, [...remote, ...translated, ...local], maximum);
      setSuggestions(hits);
      setActive((index) => Math.min(index, Math.max(0, hits.length - 1)));
    }
    function matchLocal(names: string[]) {
      local = matchLocalPromptTags(query, [...libraryTags, ...names], maximum).map((hit) => ({ ...hit, zh: autocompleteTagTranslation(hit.name) }));
      publish();
    }
    matchLocal([]);
    void loadPromptCompletionWordlist().then((names) => {
      if (request.current === pending) matchLocal(names);
    });
    if (remote.length) return;

    pending.timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/tags?mode=autocomplete&q=${encodeURIComponent(query)}`, { cache: "no-store", signal: pending.controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { tags?: PromptCompletion[] };
        if (pending.controller.signal.aborted || !Array.isArray(result.tags)) return;
        remote = result.tags.filter((hit) => typeof hit?.name === "string");
        if (remote.length) {
          if (remoteCache.size >= 200) remoteCache.clear();
          remoteCache.set(query, { hits: remote, expiresAt: Date.now() + 5 * 60_000 });
        }
        publish();
      } catch { /* Keep local suggestions when the service is unavailable. */ }
    }, 260);
  }

  return {
    listId, suggestions, active, setActive, search, dismiss, display,
    refresh(field: Field) {
      if (!request.current) return false;
      search(field);
      return true;
    },
    isComposing(event?: KeyboardEvent<Field>) { return composing.current || event?.nativeEvent.isComposing || event?.keyCode === 229; },
    onCompositionStart() { composing.current = true; dismiss(); },
    onCompositionEnd(field: Field) {
      composing.current = false;
      // Wait for the committed input and caret on browsers that dispatch input after compositionend.
      compositionFrame.current = requestAnimationFrame(() => search(field));
    },
    onBlur() { composing.current = false; dismiss(); },
  };
}

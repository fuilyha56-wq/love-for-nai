"use client";

import { useRef, useState } from "react";
import { insertPromptCompletion, localCooccurringTags, promptCompletionText, promptTokenAt, type PromptCompletion } from "@/lib/prompt-completion";
import { autocompleteTagTranslation } from "@/lib/tag-translations";
import { PromptSuggestionList } from "./prompt-suggestion-list";
import { usePromptSuggestions } from "./use-prompt-suggestions";

export function PromptAutocompleteTextarea({ value, onChange, className, placeholder, autocomplete = false, id, onContextMenu,
  library = [], cooccurrence = false, relatedSamples = [], onCopy, onFeedback,
}: {
  value: string; onChange: (value: string) => void; className?: string; placeholder?: string; autocomplete?: boolean; id?: string;
  onContextMenu?: React.MouseEventHandler<HTMLTextAreaElement>; onCopy?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  library?: Array<{ name: string; content: string }>; cooccurrence?: boolean; relatedSamples?: string[]; onFeedback?: (message: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [related, setRelated] = useState(false);
  const completion = usePromptSuggestions(autocomplete, library, (field) => promptTokenAt(field.value, field.selectionStart ?? 0).token);
  const { suggestions, active, setActive, listId } = completion;
  const showSuggestions = suggestions.length > 0 && (related ? cooccurrence : autocomplete);

  function showRelated(element: HTMLTextAreaElement, quiet = false) {
    completion.dismiss();
    if (!cooccurrence) return;
    const selected = element.value.slice(element.selectionStart, element.selectionEnd).trim() || promptTokenAt(element.value, element.selectionStart).token;
    const hits = localCooccurringTags(selected, relatedSamples, element.value);
    setRelated(hits.length > 0);
    completion.display(hits.map((hit) => ({ ...hit, zh: autocompleteTagTranslation(hit.name) })));
    if (!hits.length && !quiet) onFeedback?.("本次历史和词库中没有这个标签的共现记录。保存含该标签的词库条目或生成图片后再试。");
  }

  function acceptTag(hit: PromptCompletion) {
    const element = textareaRef.current;
    if (!element || document.activeElement !== element) return;
    const insertion = promptCompletionText(hit);
    completion.dismiss();
    setRelated(false);
    const next = related ? { text: element.value.trimEnd() + (/[,，\n]\s*$/.test(element.value) ? " " : element.value.trim() ? ", " : "") + insertion, cursor: 0 }
      : insertPromptCompletion(element.value, element.selectionStart, insertion);
    onChange(next.text);
    const caret = related ? next.text.length : next.cursor;
    requestAnimationFrame(() => { if (document.activeElement === element) element.setSelectionRange(caret, caret); });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (completion.isComposing(event)) return;
    if (event.ctrlKey && event.shiftKey && event.code === "Space") { event.preventDefault(); showRelated(event.currentTarget); return; }
    if (!showSuggestions) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); acceptTag(suggestions[active]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); completion.dismiss(); }
  }

  return <div className="prompt-autocomplete-wrap">
    <textarea ref={textareaRef} id={id} value={value} onChange={(event) => {
      onChange(event.currentTarget.value);
      if ((event.nativeEvent as InputEvent).isComposing) return;
      setRelated(false);
      completion.search(event.currentTarget);
    }}
      onCompositionStart={completion.onCompositionStart} onCompositionEnd={(event) => {
        setRelated(false);
        completion.onCompositionEnd(event.currentTarget);
      }} onKeyDown={onKeyDown} onCopy={onCopy}
      aria-autocomplete={autocomplete ? "list" : "none"} aria-controls={showSuggestions ? listId : undefined}
      aria-activedescendant={showSuggestions ? `${listId}-${active}` : undefined}
      onBlur={completion.onBlur} onSelect={(event) => {
        if (completion.isComposing()) return;
        const field = event.currentTarget;
        if (field.selectionEnd > field.selectionStart) showRelated(field, true);
        else if (!completion.refresh(field) && related) { setRelated(false); completion.dismiss(); }
      }}
      onClick={(event) => {
        if (event.ctrlKey) showRelated(event.currentTarget);
        else completion.refresh(event.currentTarget);
      }}
      onMouseDown={(event) => { if (event.button === 2 && event.currentTarget.selectionEnd > event.currentTarget.selectionStart) event.preventDefault(); }}
      onContextMenu={onContextMenu} placeholder={placeholder} className={className} />
    {showSuggestions && <PromptSuggestionList anchor={textareaRef} listId={listId} suggestions={suggestions} active={active} setActive={setActive} accept={acceptTag} related={related} showDetails />}
  </div>;
}

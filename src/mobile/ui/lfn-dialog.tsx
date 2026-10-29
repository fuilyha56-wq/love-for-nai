"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type DialogRequest = {
  message: string;
  title?: string;
  multiline?: boolean;
  initial?: string;
  prompt: boolean;
  resolve: (value: string | boolean | null) => void;
};
const eventName = "lfn-dialog-request";

export function lfnConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    window.dispatchEvent(
      new CustomEvent<DialogRequest>(eventName, {
        detail: {
          message,
          prompt: false,
          resolve: (value) => resolve(value === true),
        },
      }),
    ),
  );
}
export function lfnPrompt(
  message: string,
  initial = "",
  options: { title?: string; multiline?: boolean } = {},
): Promise<string | null> {
  return new Promise((resolve) =>
    window.dispatchEvent(
      new CustomEvent<DialogRequest>(eventName, {
        detail: {
          message,
          ...options,
          initial,
          prompt: true,
          resolve: (value) => resolve(typeof value === "string" ? value : null),
        },
      }),
    ),
  );
}

export function LfnDialogHost() {
  const [requests, setRequests] = useState<DialogRequest[]>([]);
  const [draft, setDraft] = useState<{
    request?: DialogRequest;
    value: string;
  }>({ value: "" });
  const ref = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const current = requests[0];
  const input =
    draft.request === current ? draft.value : current?.initial || "";
  useEffect(() => {
    const receive = (event: Event) =>
      setRequests((queue) => [
        ...queue,
        (event as CustomEvent<DialogRequest>).detail,
      ]);
    window.addEventListener(eventName, receive);
    return () => window.removeEventListener(eventName, receive);
  }, []);
  function finish(value: string | boolean | null) {
    current?.resolve(value);
    setRequests((queue) => queue.slice(1));
  }
  useEffect(() => {
    if (!current) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (modal && !modal.open) modal.showModal();
    ref.current
      ?.querySelector<HTMLElement>(current.prompt ? "input,textarea" : "button")
      ?.focus({ preventScroll: true });
    return () => {
      if (modal?.open) modal.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [current]);
  if (!current) return null;
  return createPortal(
    <dialog
      ref={modalRef}
      className="lfn-dialog-backdrop"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        finish(current.prompt ? null : false);
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget)
          finish(current.prompt ? null : false);
      }}
    >
      <div
        ref={ref}
        className="lfn-dialog"
        onKeyDown={(event) => {
          if (
            current.multiline &&
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            finish(input);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(current.prompt ? null : false);
          }
          if (event.key === "Tab") {
            const items = ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
            );
            if (!items?.length) return;
            const first = items[0],
              last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            finish(current.prompt ? input : true);
          }}
        >
          <header>
            <h2 id={titleId}>
              {current.title || (current.prompt ? "填写信息" : "确认操作")}
            </h2>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => finish(current.prompt ? null : false)}
            >
              <X size={18} />
            </button>
          </header>
          <p>{current.message}</p>
          {current.prompt && current.multiline && (
            <textarea
              className="field"
              aria-label="待粘贴文本"
              rows={5}
              value={input}
              onChange={(event) =>
                setDraft({ request: current, value: event.target.value })
              }
            />
          )}
          {current.prompt && !current.multiline && (
            <input
              className="field"
              aria-label={current.message}
              value={input}
              onChange={(event) =>
                setDraft({ request: current, value: event.target.value })
              }
            />
          )}
          <footer>
            <button
              className="lfn-button"
              type="button"
              onClick={() => finish(current.prompt ? null : false)}
            >
              取消
            </button>
            <button className="lfn-button is-primary" type="submit">
              确认
            </button>
          </footer>
        </form>
      </div>
    </dialog>,
    document.body,
  );
}

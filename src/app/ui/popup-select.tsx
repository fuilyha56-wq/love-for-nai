"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  // 可选第二行说明（如分组倍率），有值时菜单项渲染两行。
  description?: string;
};

// 全站统一下拉控件：触发按钮 + Portal 菜单（fixed 定位，避免被
// overflow 容器裁剪），支持键盘上下切换、滚动跟随、可选搜索。
// 搜索占位词按场景传入（如“搜索模型”）。
export function PopupSelect({
  value,
  options,
  onChange,
  ariaLabel,
  searchable = false,
  searchPlaceholder = "搜索",
  emptyText = "没有匹配项",
  disabled = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({
    position: "fixed",
    visibility: "hidden",
  });
  const visible =
    searchable && query.trim()
      ? options.filter((option) =>
          `${option.label} ${option.value} ${option.description || ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
      : options;

  function positionMenu() {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const gap = 6;
    const availableBelow = window.innerHeight - trigger.bottom - gap - 8;
    const availableAbove = trigger.top - gap - 8;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    setMenuStyle({
      position: "fixed",
      visibility: "visible",
      left: trigger.left,
      top: openAbove ? undefined : trigger.bottom + gap,
      bottom: openAbove ? window.innerHeight - trigger.top + gap : undefined,
      width: trigger.width,
      maxHeight: Math.max(
        120,
        Math.min(360, openAbove ? availableAbove : availableBelow),
      ),
    });
  }

  useLayoutEffect(() => {
    if (open) positionMenu();
  }, [open]);

  // 首次点击时按钮宽度可能与菜单渲染时不同（字体加载、面板布局），
  // 用 ResizeObserver 持续对齐菜单与触发按钮。
  useEffect(() => {
    if (!open) return;
    const trigger = rootRef.current;
    if (!trigger || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => positionMenu());
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  function select(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  const selected = options.find((option) => option.value === value);

  return (
    <div className="popup-select" ref={rootRef}>
      <button
        type="button"
        className="popup-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!open) positionMenu();
          setOpen((current) => !current);
          setQuery("");
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const current = options.findIndex((option) => option.value === value);
          const direction = event.key === "ArrowDown" ? 1 : -1;
          select(
            options[(current + direction + options.length) % options.length],
          );
        }}
      >
        <span>{selected?.label || value}</span>
        <span className="popup-select-chevrons" aria-hidden="true">
          <ChevronsUpDown size={12} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            id={listboxId}
            ref={menuRef}
            className="popup-select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            onWheel={(event) => event.stopPropagation()}
          >
            {searchable && (
              <div className="popup-select-search">
                <Search size={12} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  autoFocus
                />
              </div>
            )}
            <div className="popup-select-options">
              {visible.length === 0 ? (
                <p className="popup-select-empty">{emptyText}</p>
              ) : (
                visible.map((option) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className="popup-select-option"
                    key={option.value}
                    onClick={() => select(option)}
                  >
                    <Check
                      size={13}
                      className={
                        option.value === value ? "opacity-100" : "opacity-0"
                      }
                    />
                    <span>
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="popup-select-description">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

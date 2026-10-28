"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  useEffect,
  useCallback,
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
  disabled?: boolean;
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
  className = "",
  triggerClassName = "",
  menuClassName = "",
  menuMinWidth = 0,
  id,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  menuMinWidth?: number;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
  const selectedIndex = Math.max(
    0,
    visible.findIndex((option) => option.value === value),
  );

  const positionMenu = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportHeight = viewport?.height || window.innerHeight;
    const viewportWidth = viewport?.width || window.innerWidth;
    const gap = 6;
    const availableBelow = Math.max(0, viewportTop + viewportHeight - trigger.bottom - gap - 8);
    const availableAbove = Math.max(0, trigger.top - viewportTop - gap - 8);
    const contentHeight = (optionsRef.current?.scrollHeight || Math.max(1, visible.length) * 38) + (searchable ? 44 : 0) + 10;
    const desiredHeight = Math.min(400, contentHeight);
    const openAbove = availableBelow < desiredHeight && availableAbove > availableBelow;
    const available = openAbove ? availableAbove : availableBelow;
    const height = Math.min(desiredHeight, available);
    const width = Math.min(Math.max(trigger.width, menuMinWidth), viewportWidth - 16);
    setMenuStyle({
      position: "fixed",
      visibility: "visible",
      left: Math.max(8, Math.min(trigger.left, viewportWidth - width - 8)),
      top: openAbove ? Math.max(viewportTop + 8, trigger.top - gap - height) : trigger.bottom + gap,
      width,
      height,
      maxHeight: available,
      transform: "none",
      transformOrigin: openAbove ? "bottom left" : "top left",
    });
  }, [searchable, visible.length, menuMinWidth]);

  useLayoutEffect(() => {
    if (open) {
      positionMenu();
      // Touch devices must be able to scroll the list without opening the IME.
      if (searchable && window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus({ preventScroll: true });
      else menuRef.current?.focus({ preventScroll: true });
    }
  }, [open, searchable, positionMenu]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = optionsRef.current;
    const active = list?.querySelector<HTMLElement>(".is-active");
    if (!list || !active) return;
    if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop;
    else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight;
  }, [open, activeIndex]);

  // 首次点击时按钮宽度可能与菜单渲染时不同（字体加载、面板布局），
  // 用 ResizeObserver 持续对齐菜单与触发按钮。
  useEffect(() => {
    if (!open) return;
    const trigger = rootRef.current;
    if (!trigger || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => positionMenu());
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    function escape(event: KeyboardEvent) {
      if (!event.defaultPrevented && event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setQuery("");
        rootRef.current?.querySelector("button")?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionMenu);
    let frame = 0;
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(positionMenu);
    };
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", positionMenu);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      cancelAnimationFrame(frame);
    };
  }, [open, positionMenu]);

  function select(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery("");
    rootRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }

  function resetActiveIndex() {
    setActiveIndex(selectedIndex);
  }

  function moveActive(direction: number) {
    if (!visible.length) return;
    setActiveIndex((current) => {
      for (let step = 1; step <= visible.length; step++) {
        const next = (current + direction * step + visible.length) % visible.length;
        if (!visible[next].disabled) return next;
      }
      return current;
    });
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
      rootRef.current?.querySelector("button")?.focus({ preventScroll: true });
    } else if (event.key === "Tab") {
      setOpen(false);
      setQuery("");
      rootRef.current?.querySelector("button")?.focus({ preventScroll: true });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, visible.length - 1));
    } else if (event.key === "Enter" && visible[activeIndex]) {
      event.preventDefault();
      select(visible[activeIndex]);
    }
  }

  const selected = options.find((option) => option.value === value);

  return (
    <div className={`popup-select ${className}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className={`popup-select-trigger ${triggerClassName}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!open) positionMenu();
          setOpen((current) => !current);
          setQuery("");
          resetActiveIndex();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          if (!options.length) return;
          event.preventDefault();
          positionMenu();
          setOpen(true);
          setQuery("");
          resetActiveIndex();
        }}
      >
        <span>{selected?.label || value || "请选择"}</span>
        <span className="popup-select-chevrons" aria-hidden="true">
          <ChevronsUpDown size={12} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            id={listboxId}
            ref={menuRef}
            className={`popup-select-menu ${menuClassName}`}
            role="listbox"
            aria-label={ariaLabel}
            aria-activedescendant={visible[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
            tabIndex={-1}
            style={menuStyle}
            onKeyDown={handleMenuKeyDown}
            onWheel={(event) => event.stopPropagation()}
          >
            {searchable && (
              <div className="popup-select-search">
                <Search size={12} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                />
              </div>
            )}
            <div className="popup-select-options" ref={optionsRef}>
              {visible.length === 0 ? (
                <p className="popup-select-empty">{emptyText}</p>
              ) : (
                visible.map((option, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`${listboxId}-option-${index}`}
                    tabIndex={-1}
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    className={`popup-select-option ${option.value === visible[activeIndex]?.value ? "is-active" : ""}`}
                    key={option.value}
                    onMouseEnter={() => setActiveIndex(visible.findIndex((item) => item.value === option.value))}
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

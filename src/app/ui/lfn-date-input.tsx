"use client";

import type { ChangeEvent, InputHTMLAttributes } from "react";
import { DateRangePicker } from "./date-range-picker";

export function LfnDateInput({
  value = "",
  onChange,
  type,
  name,
  disabled,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const current = String(value);
  const date = current.slice(0, 10);
  const time = current.slice(11, 16) || "00:00";
  const dateTime = type === "datetime-local";
  function change(next: string) {
    const target = { value: next, name: name || "" } as HTMLInputElement;
    onChange?.({
      target,
      currentTarget: target,
    } as ChangeEvent<HTMLInputElement>);
  }
  return (
    <div className={`lfn-date-input ${className}`}>
      <DateRangePicker
        single
        disabled={disabled}
        value={{ start: date, end: date }}
        min={String(props.min || "")}
        max={String(props.max || "")}
        ariaLabel={props["aria-label"] || name || "选择日期"}
        onChange={(next) =>
          change(dateTime && next.start ? `${next.start}T${time}` : next.start)
        }
      />
      {dateTime && (
        <input
          className="lfn-time-input"
          aria-label="时间，时:分"
          value={time}
          inputMode="numeric"
          disabled={disabled}
          maxLength={5}
          placeholder="HH:mm"
          pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
          onChange={(event) => change(`${date}T${event.target.value}`)}
        />
      )}
      {current && (
        <button
          type="button"
          className="lfn-date-clear"
          aria-label="清除日期"
          disabled={disabled}
          onClick={() => change("")}
        >
          ×
        </button>
      )}
      {name && <input type="hidden" name={name} value={current} />}
    </div>
  );
}

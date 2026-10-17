"use client";

import {
  Children,
  isValidElement,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { PopupSelect, type SelectOption } from "./popup-select";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

function optionsOf(children: ReactNode): SelectOption[] {
  const result: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        disabled?: boolean;
        label?: string;
      }>(child)
    )
      return;
    if (child.type === "option") {
      const label = child.props.label || textOf(child.props.children);
      result.push({
        value: String(child.props.value ?? label),
        label,
        disabled: child.props.disabled,
      });
    } else result.push(...optionsOf(child.props.children));
  });
  return result;
}

/** Compatibility with existing select forms; rendering and keyboard behavior use LFN's shared selector. */
export function LfnSelect({
  children,
  value,
  defaultValue,
  onChange,
  className = "",
  name,
  id,
  disabled,
  required,
  style,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = optionsOf(children);
  const [localValue, setLocalValue] = useState(
    String(defaultValue ?? options.find((item) => !item.disabled)?.value ?? ""),
  );
  const selected = value === undefined ? localValue : String(value);
  return (
    <div className={`lfn-select ${className}`} style={style}>
      <PopupSelect
        id={id}
        value={selected}
        options={options}
        disabled={disabled}
        ariaLabel={props["aria-label"] || props.title || name || "选择选项"}
        onChange={(next) => {
          setLocalValue(next);
          const target = {
            value: next,
            name: name || "",
            id: id || "",
          } as HTMLSelectElement;
          onChange?.({
            target,
            currentTarget: target,
          } as ChangeEvent<HTMLSelectElement>);
        }}
      />
      {name && (
        <input
          type="hidden"
          name={name}
          value={selected}
          disabled={disabled}
          required={required}
        />
      )}
    </div>
  );
}

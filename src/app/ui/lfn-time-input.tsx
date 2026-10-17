"use client";
import type { InputHTMLAttributes } from "react";

export function LfnTimeInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      maxLength={5}
      autoComplete="off"
      placeholder="HH:mm"
      pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
    />
  );
}

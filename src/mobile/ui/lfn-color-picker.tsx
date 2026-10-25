"use client";

import { useState } from "react";
import { AdaptiveDialog } from "./adaptive-dialog";

const swatches = ["#a83a4c", "#d65773", "#b97129", "#4e8566", "#4076a7", "#7564a5", "#30343b"];

export function LfnColorPicker({ value, onChange, ariaLabel = "选择自定义强调色" }: { value: string; onChange: (value: string) => void; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const safeColor = /^#[\da-f]{6}$/i.test(value) ? value : "#a83a4c";
  const rgb = [1, 3, 5].map(start => parseInt(safeColor.slice(start, start + 2), 16));
  function choose(color: string) { setHex(color); onChange(color); }
  return <>
    <button type="button" className="lfn-button lfn-color-trigger" aria-expanded={open} aria-haspopup="dialog" aria-label={ariaLabel} onClick={() => { setHex(value); setOpen(true); }}><span style={{ backgroundColor: safeColor }} aria-hidden="true" />{value}</button>
    {open && <AdaptiveDialog label="LFN 取色器" onClose={() => setOpen(false)} className="lfn-color-dialog">
      <header><h2>自定义颜色</h2><button type="button" aria-label="关闭取色器" onClick={() => setOpen(false)}>×</button></header>
      <div className="lfn-color-content">
        <div className="lfn-color-preview" style={{ backgroundColor: safeColor }} aria-label={`当前颜色 ${safeColor}`} />
        <div className="lfn-color-swatches">{swatches.map(color => <button type="button" key={color} aria-label={`选择 ${color}`} aria-pressed={safeColor.toLowerCase() === color} onClick={() => choose(color)}><span style={{ backgroundColor: color }} /></button>)}</div>
        {["红", "绿", "蓝"].map((label, index) => <label className="lfn-color-channel" key={label}><span>{label}</span><input type="range" aria-label={`${label}色通道`} min={0} max={255} value={rgb[index]} onChange={event => { const next = [...rgb]; next[index] = Number(event.target.value); choose(`#${next.map(channel => channel.toString(16).padStart(2, "0")).join("")}`); }} /><output>{rgb[index]}</output></label>)}
        <label className="lfn-color-hex">颜色代码<input className="field" aria-label="颜色代码" value={hex} maxLength={7} spellCheck={false} onChange={event => { setHex(event.target.value); if (/^#[\da-f]{6}$/i.test(event.target.value)) onChange(event.target.value); }} /></label>
      </div>
      <footer><button type="button" className="settings-primary-button" onClick={() => setOpen(false)}>完成</button></footer>
    </AdaptiveDialog>}
  </>;
}

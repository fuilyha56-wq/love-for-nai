import {
  VIEWPORT_DIAGNOSTIC_BOUNDS,
  VIEWPORT_DIAGNOSTIC_CAPTURE_RE,
  VIEWPORT_DIAGNOSTIC_DURATION_MS,
  VIEWPORT_DIAGNOSTIC_EVENT,
  VIEWPORT_DIAGNOSTIC_MAX_BYTES,
  VIEWPORT_DIAGNOSTIC_MAX_ROWS,
  VIEWPORT_DIAGNOSTIC_VERSION,
} from "./viewport-diagnostic-schema";

export function keyboardProbePage(mode: "content" | "overlay") {
  const config = JSON.stringify({
    mode, bounds: VIEWPORT_DIAGNOSTIC_BOUNDS, tokenPattern: VIEWPORT_DIAGNOSTIC_CAPTURE_RE.source,
    duration: VIEWPORT_DIAGNOSTIC_DURATION_MS, events: VIEWPORT_DIAGNOSTIC_EVENT,
    maxBytes: VIEWPORT_DIAGNOSTIC_MAX_BYTES, maxRows: VIEWPORT_DIAGNOSTIC_MAX_ROWS,
    version: VIEWPORT_DIAGNOSTIC_VERSION,
  });
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=${mode === "overlay" ? "overlays-content" : "resizes-content"}">
<title>键盘尺寸对照</title><link rel="icon" href="data:,">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,sans-serif;color:#18212d;background:#f4f6f8}body{overflow:hidden}
#probe{height:100dvh;display:flex;flex-direction:column;overflow:hidden;background:white}.overlay #probe{padding-bottom:env(keyboard-inset-height,0px)}
header{flex:none;padding:8px 10px;border-bottom:1px solid #c8d0da;background:#edf3fa}h1{font-size:16px;line-height:20px;margin:0}p{margin:5px 0;font-size:12px;line-height:17px}
nav{display:flex;gap:8px;margin:6px 0}a{color:#194c9b;font-size:12px;padding:4px 6px;border:1px solid #8ca7ce;border-radius:4px}a[aria-current=page]{font-weight:700;background:#d3e4ff}
#readout{height:32px;overflow:hidden;white-space:pre;font:11px/16px ui-monospace,monospace;font-variant-numeric:tabular-nums}button{font:inherit;font-size:13px;min-height:32px;border:1px solid #7292bc;border-radius:5px;background:#e3efff;color:#173d70;padding:5px 8px}button:disabled{opacity:.65}#record{width:100%;margin-top:5px;white-space:nowrap}
#middle{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px}label{display:block;font-size:13px;line-height:20px}textarea{display:block;width:100%;resize:none;font:16px/22px system-ui,sans-serif;border:1px solid #9aa9bc;border-radius:5px;padding:7px;background:#fff;color:#18212d}#upper{height:66px}#middle p{margin:15px 0;line-height:20px}
#composer{flex:none;padding:7px 10px;border-top:1px solid #c8d0da;background:#edf3fa}.input-row{display:flex;align-items:stretch;gap:7px}#lower{height:58px;min-width:0;flex:1}.input-row button{flex:none}
#measure{position:fixed;top:0;left:0;width:0;height:100dvh;visibility:hidden;pointer-events:none;--key-top:env(keyboard-inset-top,0px);--key-height:env(keyboard-inset-height,0px);--key-width:env(keyboard-inset-width,0px);--key-left:env(keyboard-inset-left,0px);--key-bottom:env(keyboard-inset-bottom,0px)}
</style></head><body class="${mode}"><main id="probe">
<header><h1>键盘尺寸对照 · ${mode === "overlay" ? "覆盖模式" : "内容缩放模式"}</h1>
<p>独立页面，不改变正式工作台。仅记录尺寸，不保存输入文字。</p>
<nav aria-label="对照模式"><a data-mode="content" href="?mode=content" ${mode === "content" ? 'aria-current="page"' : ""}>内容缩放</a><a data-mode="overlay" href="?mode=overlay" ${mode === "overlay" ? 'aria-current="page"' : ""}>覆盖 + CSS env</a></nav>
<div id="readout" aria-label="实时尺寸"></div><button id="record" type="button" disabled>需要有效诊断链接</button></header>
<section id="middle" aria-label="可滚动中间区域"><label for="upper">上部输入框</label><textarea id="upper" placeholder="点这里弹出键盘" autocomplete="off"></textarea>
<p>先点击上方的记录按钮，再交替点击上下输入框，收起并重新弹出键盘。</p><p>观察底部输入框是否被遮挡、键盘上方是否出现空白，以及中间内容是否能滚动。</p><p>内容缩放模式：浏览器调整页面尺寸。覆盖模式：页面仅使用 CSS 键盘环境变量避让；变量为 0 时可能不会避让，这正是本页要记录的对照结果。</p><p>输入任意测试文字即可，不会发送文字。</p></section>
<footer id="composer"><label for="lower">底部输入框</label><div class="input-row"><textarea id="lower" placeholder="点这里再次对照" autocomplete="off"></textarea><button id="dismiss" type="button">收起</button></div></footer>
</main><div id="measure" aria-hidden="true"></div>
<script>
(() => {
"use strict";
const config = ${config};
const E = config.events;
const root = document.documentElement, body = document.body;
const panel = document.getElementById("probe"), middle = document.getElementById("middle"), composer = document.getElementById("composer");
const measure = document.getElementById("measure"), lower = document.getElementById("lower");
const button = document.getElementById("record"), readout = document.getElementById("readout");
const viewport = window.visualViewport, keyboard = navigator.virtualKeyboard;
const validToken = new RegExp(config.tokenPattern, "i");
let capture = "", state = "ready", savedPayload = null, stop = null, request = null;
function env() {
  const style = getComputedStyle(measure);
  return ["top", "height", "width", "left", "bottom"].map(name => Number.parseFloat(style.getPropertyValue("--key-" + name)) || 0);
}
function metrics() {
  const k = env();
  readout.textContent = "VV " + (viewport ? viewport.height.toFixed(1) : "n/a") + " · inner " + innerHeight + " · dvh " + measure.getBoundingClientRect().height.toFixed(1)
    + "\\nenv top/h/w/l/b: " + k.map(value => value.toFixed(1)).join(" / ");
}
function tokenChanged() {
  const value = (new URLSearchParams(location.hash.slice(1)).get("viewportTrace") || "").toLowerCase();
  capture = validToken.test(value) ? value : "";
  document.querySelectorAll("a[data-mode]").forEach(link => {
    link.href = "?mode=" + link.dataset.mode + (capture ? "#viewportTrace=" + capture : "");
  });
  if (state === "ready") {
    button.disabled = !capture;
    button.textContent = capture ? "开始20秒记录并发送" : "需要有效诊断链接";
  }
}
function box(node) {
  if (!node) return [-1, -1, -1];
  const rect = node.getBoundingClientRect();
  return [node.scrollTop, rect.top, rect.height];
}
function snapshot(start, mask) {
  const active = document.activeElement;
  const textarea = active instanceof HTMLTextAreaElement ? active : lower;
  const rect = panel.getBoundingClientRect(), k = env();
  const kind = !active ? 0 : active === body ? 1 : active instanceof HTMLTextAreaElement ? 2
    : active instanceof HTMLInputElement ? 3 : active.isContentEditable ? 4 : 5;
  // Schema 1: main/panel are the CSS page, pane/transcript the scrollable middle.
  // vk_y/vk_height carry CSS env top/height here; vk_available remains the real API presence.
  const row = [performance.now() - start, mask, innerHeight, innerWidth, root.clientHeight,
    viewport ? viewport.height : -1, viewport ? viewport.width : -1, viewport ? viewport.offsetTop : -1,
    viewport ? viewport.offsetLeft : -1, viewport ? viewport.scale : -1, viewport ? viewport.pageTop : -1,
    measure.getBoundingClientRect().height, rect.height, rect.top, scrollY, isSecureContext ? 1 : 0, keyboard ? 1 : 0,
    ...box(body), ...box(root), ...box(panel), -1, -1, -1, -1, -1, -1,
    ...box(middle), ...box(panel), ...box(middle), ...box(composer), ...box(textarea),
    body.clientHeight, body.scrollHeight, root.scrollHeight, panel.clientHeight, panel.scrollHeight,
    kind, 0, k[0], k[1], config.mode === "overlay" ? 1 : 0, config.mode === "content" ? 1 : 0, document.hidden ? 1 : 0];
  return row.map((value, index) => {
    const bound = config.bounds[index];
    return Math.round(Math.max(bound[0], Math.min(bound[1], Number.isFinite(value) ? value : -1)) * 100) / 100;
  });
}
async function upload() {
  if (!savedPayload || !validToken.test(savedPayload.capture)) return;
  state = "uploading"; button.disabled = true; button.textContent = "正在发送尺寸记录…";
  request = new AbortController();
  try {
    const response = await fetch("/api/diagnostics/viewport", {method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(savedPayload), signal:request.signal, credentials:"omit", referrerPolicy:"no-referrer", cache:"no-store"});
    if (!response.ok) throw new Error("Upload failed");
    const result = await response.json();
    state = "ready"; savedPayload = null; tokenChanged();
    button.textContent = "已发送 " + (typeof result.receipt === "string" ? result.receipt : "") + " · 再次记录";
  } catch {
    state = "error"; button.disabled = false; button.textContent = "发送失败 · 点击重试原记录";
  }
}
function begin() {
  if (!capture || state === "recording" || state === "uploading") return;
  if (state === "error") { void upload(); return; }
  const payload = {capture, version:config.version, rows:[]};
  savedPayload = null; state = "recording"; button.disabled = true;
  const started = performance.now();
  let stopped = false, frame = 0, pending = 0, previous = null, lastAt = -Infinity, seconds = -1;
  let bytes = JSON.stringify(payload).length;
  const removers = [];
  function append(row, force = false) {
    const size = JSON.stringify(row).length;
    if (force) while (payload.rows.length && (payload.rows.length >= config.maxRows || bytes + size + 1 > config.maxBytes)) {
      bytes -= JSON.stringify(payload.rows.pop()).length + (payload.rows.length ? 1 : 0);
    }
    if (payload.rows.length >= config.maxRows || bytes + size + (payload.rows.length ? 1 : 0) > config.maxBytes) return;
    bytes += size + (payload.rows.length ? 1 : 0); payload.rows.push(row);
  }
  function record(mask) { if (!stopped) { pending |= mask; append(snapshot(started, mask)); metrics(); } }
  function listen(target, name, mask, capturePhase = false) {
    if (!target) return;
    const listener = () => record(mask);
    target.addEventListener(name, listener, capturePhase);
    removers.push(() => target.removeEventListener(name, listener, capturePhase));
  }
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    let mask = 0;
    for (const entry of entries) mask |= entry.target === root ? E.root_resize : entry.target === body ? E.body_resize : E.portal_resize;
    record(mask);
  });
  if (observer) [root, body, panel].forEach(node => observer.observe(node));
  listen(viewport,"resize",E.visual_resize); listen(viewport,"scroll",E.visual_scroll);
  listen(window,"resize",E.window_resize); listen(window,"scroll",E.window_scroll);
  listen(document,"scroll",E.element_scroll,true); listen(document,"focusin",E.focus_in,true); listen(document,"focusout",E.focus_out,true);
  listen(document,"selectionchange",E.selection_change); listen(document,"compositionstart",E.composition_start,true); listen(document,"compositionend",E.composition_end,true);
  listen(document,"visibilitychange",E.visibility_change); listen(keyboard,"geometrychange",E.keyboard_geometry);
  function sample() {
    if (stopped) return;
    const row = snapshot(started, pending ? pending | E.after_event_frame : E.geometry_frame);
    const changed = !previous || row.some((value,index) => index >= 2 && value !== previous[index]);
    if (pending || changed || row[0] - lastAt >= 100) {
      if (!pending && !changed) row[1] = E.heartbeat;
      append(row); lastAt = row[0];
    }
    previous = row; pending = 0;
    const remaining = Math.max(0, Math.ceil((config.duration - row[0]) / 1000));
    if (remaining !== seconds) { seconds = remaining; button.textContent = "尺寸记录中 · " + seconds + "秒"; }
    metrics(); frame = requestAnimationFrame(sample);
  }
  function cleanup() {
    stopped = true; cancelAnimationFrame(frame); clearTimeout(timer);
    if (observer) observer.disconnect(); removers.forEach(remove => remove()); stop = null;
  }
  const timer = setTimeout(() => {
    append(snapshot(started, E.end), true); cleanup(); savedPayload = payload; void upload();
  }, config.duration);
  stop = cleanup; append(snapshot(started, E.start)); frame = requestAnimationFrame(sample);
}
button.addEventListener("click", begin);
document.getElementById("dismiss").addEventListener("pointerdown", () => {
  if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
});
window.addEventListener("hashchange", tokenChanged);
window.addEventListener("resize", metrics);
if (viewport) viewport.addEventListener("resize", metrics);
window.addEventListener("pagehide", () => { if (stop) stop(); if (request) request.abort(); });
tokenChanged(); metrics();
})();
</script></body></html>`;
}

"use client";

type SaveHandle = { createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }> };
type FilePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle> };
export function safeSaveFilename(value: string) { return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").slice(0, 180) || "image.png"; }
export async function saveImageBlobAs(blob: Blob, suggestedName: string): Promise<boolean> {
  const picker = (window as FilePickerWindow).showSaveFilePicker;
  if (picker) {
    let handle: SaveHandle;
    try { handle = await picker.call(window, { suggestedName: safeSaveFilename(suggestedName), types: [{ description: "图像文件", accept: { [blob.type || "image/png"]: [blob.type === "image/jpeg" ? ".jpg" : blob.type === "image/webp" ? ".webp" : ".png"] } }] }); }
    catch (error) { if (error instanceof Error && error.name === "AbortError") return false; if (!(error instanceof Error && ["SecurityError", "NotAllowedError"].includes(error.name))) throw error; return fallbackSave(blob, suggestedName); }
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); return true; } catch (error) { await writable.abort?.().catch(() => {}); throw error; }
  }
  return fallbackSave(blob, suggestedName);
}
function fallbackSave(blob: Blob, suggestedName: string) {
  const requested = window.prompt("保存文件名", safeSaveFilename(suggestedName)); if (requested === null) return false;
  const link = document.createElement("a"), url = URL.createObjectURL(blob); link.href = url; link.download = safeSaveFilename(requested); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
}

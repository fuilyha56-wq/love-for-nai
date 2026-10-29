"use client";

import { type ComicProject } from "./comic-project";

async function loadImage(source: string) { return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("候选图未能加载。")); image.src = source; }); }
export async function renderComicPage(project: ComicProject): Promise<Blob> {
  const canvas = document.createElement("canvas"); canvas.width = project.width; canvas.height = project.height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器不支持图片导出。");
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  for (const panel of project.panels) {
    const left = panel.x * project.width + project.gutter / 2, top = panel.y * project.height + project.gutter / 2;
    const width = Math.max(1, panel.width * project.width - project.gutter), height = Math.max(1, panel.height * project.height - project.gutter);
    context.save(); context.beginPath(); context.rect(left, top, width, height); context.clip();
    context.fillStyle = "#f1f1f1"; context.fillRect(left, top, width, height);
    const candidate = panel.candidates.find((item) => item.id === panel.selectedId);
    if (candidate) { const image = await loadImage(candidate.image), scale = Math.min(width / image.naturalWidth, height / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale; context.drawImage(image, left + (width - w) / 2, top + (height - h) / 2, w, h); }
    for (const dialogue of panel.dialogues) {
      const maxWidth = Math.max(1, Math.min(dialogue.width, 1 - dialogue.x) * width), x = left + dialogue.x * width, y = top + dialogue.y * height;
      context.font = `${dialogue.fontSize}px sans-serif`; context.textBaseline = "top";
      const lines: string[] = []; for (const paragraph of dialogue.text.split("\n")) { let line = ""; for (const char of paragraph) { if (line && context.measureText(line + char).width > maxWidth - 16) { lines.push(line); line = char; } else line += char; } lines.push(line); }
      const lineHeight = dialogue.fontSize * 1.35, boxHeight = lines.length * lineHeight + 16;
      context.fillStyle = "rgba(255,255,255,.94)"; context.fillRect(x, y, maxWidth, boxHeight);
      context.fillStyle = "#111"; lines.forEach((line, index) => context.fillText(line, x + 8, y + 8 + index * lineHeight, maxWidth - 16));
    }
    context.restore(); context.strokeStyle = "#222"; context.lineWidth = 2; context.strokeRect(left, top, width, height);
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片导出失败。")), "image/png"));
}

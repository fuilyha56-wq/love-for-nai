export type ComicDialogue = { id: string; text: string; x: number; y: number; width: number; fontSize: number };
export type ComicCandidate = { id: string; image: string; createdAt: number; prompt: string };
export type ComicPanel = { id: string; x: number; y: number; width: number; height: number; prompt: string; negative: string; dialogues: ComicDialogue[]; candidates: ComicCandidate[]; selectedId: string | null; removedCandidateIds?: string[] };
export type ComicProject = { id: string; title: string; prompt: string; negative: string; width: number; height: number; gutter: number; candidateCount: number; panels: ComicPanel[]; updatedAt: number };
export type ComicLayout = "single" | "two" | "four" | "vertical";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function panel(x: number, y: number, width: number, height: number): ComicPanel { return { id: crypto.randomUUID(), x, y, width, height, prompt: "", negative: "", dialogues: [], candidates: [], selectedId: null }; }
export function createComicPanels(layout: ComicLayout): ComicPanel[] {
  if (layout === "single") return [panel(0, 0, 1, 1)];
  if (layout === "two") return [panel(0, 0, 1, .5), panel(0, .5, 1, .5)];
  if (layout === "vertical") return [panel(0, 0, 1, 1 / 3), panel(0, 1 / 3, 1, 1 / 3), panel(0, 2 / 3, 1, 1 / 3)];
  return [panel(0, 0, .5, .5), panel(.5, 0, .5, .5), panel(0, .5, .5, .5), panel(.5, .5, .5, .5)];
}
export function createComicProject(): ComicProject { return { id: crypto.randomUUID(), title: "未命名分镜", prompt: "", negative: "", width: 1200, height: 1800, gutter: 12, candidateCount: 1, panels: createComicPanels("four"), updatedAt: Date.now() }; }
export function comicPanelPrompt(project: ComicProject, item: ComicPanel) { return { prompt: [project.prompt, item.prompt].filter(Boolean).join(", "), negative: [project.negative, item.negative].filter(Boolean).join(", ") }; }
export function parseComicProject(raw: unknown): ComicProject {
  if (!raw || typeof raw !== "object") throw new Error("分镜配置格式不正确。");
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) throw new Error("不支持此版本的分镜配置。");
  const text = (input: unknown, max: number) => typeof input === "string" ? input.slice(0, max) : "";
  const numeric = (input: unknown, fallback: number, min: number, max: number) => typeof input === "number" && Number.isFinite(input) ? clamp(input, min, max) : fallback;
  const uuid = () => crypto.randomUUID();
  if (!Array.isArray(value.panels) || value.panels.length < 1 || value.panels.length > 12) throw new Error("每页需包含 1–12 个分镜。");
  return { id: uuid(), title: text(value.title, 120) || "导入分镜", prompt: text(value.prompt, 20000), negative: text(value.negative, 20000), width: Math.round(numeric(value.width, 1200, 256, 4096)), height: Math.round(numeric(value.height, 1800, 256, 8192)), gutter: numeric(value.gutter, 12, 0, 100), candidateCount: Math.round(numeric(value.candidateCount, 1, 1, 6)), updatedAt: Date.now(), panels: value.panels.map((rawPanel): ComicPanel => {
    if (!rawPanel || typeof rawPanel !== "object") throw new Error("分镜内容不完整。");
    const item = rawPanel as Record<string, unknown>;
    const x = numeric(item.x, 0, 0, .99), y = numeric(item.y, 0, 0, .99);
    const candidates: ComicCandidate[] = Array.isArray(item.candidates) ? item.candidates.slice(-10).map((rawCandidate): ComicCandidate => {
      const candidate = rawCandidate as Record<string, unknown>;
      if (!candidate || typeof candidate.image !== "string" || candidate.image.length > 24 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidate.image)) throw new Error("候选图格式不受支持。");
      return { id: uuid(), image: candidate.image, createdAt: Date.now(), prompt: text(candidate.prompt, 40000) };
    }) : [];
    const oldSelected = Array.isArray(item.candidates) ? item.candidates.slice(-10).findIndex((candidate) => candidate && candidate.id === item.selectedId) : -1;
    return { id: uuid(), x, y, width: numeric(item.width, .5, .01, 1 - x), height: numeric(item.height, .5, .01, 1 - y), prompt: text(item.prompt, 20000), negative: text(item.negative, 20000), candidates, selectedId: candidates[oldSelected]?.id ?? candidates[0]?.id ?? null,
      dialogues: Array.isArray(item.dialogues) ? item.dialogues.slice(0, 20).map((rawDialogue): ComicDialogue => { const dialogue = rawDialogue as Record<string, unknown>; if (!dialogue || typeof dialogue !== "object") throw new Error("对白内容不完整。"); return { id: uuid(), text: text(dialogue.text, 2000), x: numeric(dialogue.x, .08, 0, .9), y: numeric(dialogue.y, .08, 0, .9), width: numeric(dialogue.width, .8, .1, 1), fontSize: numeric(dialogue.fontSize, 28, 12, 120) }; }) : [],
    };
  }) };
}

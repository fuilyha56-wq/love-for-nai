import {
  imagePromptText,
  readImageCharacterPrompts,
} from "@/lib/image-character-prompts";

export type GalleryPromptMode = "full" | "partial" | "hidden" | "none";
export type GalleryMetadataState = "readable" | "missing" | "unknown";
export type PublicCharacterText = {
  sourceIndex: number;
  prompt: string;
  negativePrompt: string;
};
export type GalleryPublicationInput = {
  promptMode?: GalleryPromptMode;
  partialPrompt?: string;
  partialNegativePrompt?: string;
  partialCharacters?: PublicCharacterText[];
  upscaled?: boolean;
};

/** A readable source may intentionally have an empty main prompt or role-only prompts. */
export function hasReadableGenerationMetadata(source: Record<string, unknown> | null | undefined): source is Record<string, unknown> {
  return Boolean(source && (["prompt", "input", "negative_prompt", "negativePrompt", "uc"].some(key => typeof source[key] === "string") || source.v4_prompt || source.v4_negative_prompt || readImageCharacterPrompts(source).length));
}

/** Flatten tags with their exact emphasis ancestry; commas inside a weighted group remain scoped. */
export function promptAtoms(text: string): string[] {
  const atoms: string[] = [];
  let index = 0;
  function parse(scopes: string[], closing = "") {
    let leaf = "";
    const flush = () => {
      const value = leaf.trim();
      if (value) atoms.push(JSON.stringify([scopes, value]));
      leaf = "";
    };
    while (index < text.length) {
      if (closing && text.startsWith(closing, index)) {
        flush();
        index += closing.length;
        return;
      }
      const char = text[index];
      if (char === "\\") {
        if (index + 1 >= text.length) throw new Error("提示词转义不完整");
        leaf += text.slice(index, index + 2);
        index += 2;
        continue;
      }
      if ((char === '"' || char === "'") && !leaf.trim()) {
        const quote = char;
        leaf += char;
        index++;
        let ended = false;
        while (index < text.length) {
          const next = text[index++];
          leaf += next;
          if (next === "\\" && index < text.length) leaf += text[index++];
          else if (next === quote) {
            ended = true;
            break;
          }
        }
        if (!ended) throw new Error("提示词引号不完整");
        continue;
      }
      if (text.startsWith("/*", index)) {
        const end = text.indexOf("*/", index + 2);
        if (end < 0) throw new Error("提示词注释不完整");
        leaf += text.slice(index, end + 2);
        index = end + 2;
        continue;
      }
      const numeric = !leaf.trim()
        ? text.slice(index).match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))::/)
        : null;
      if (numeric) {
        flush();
        index += numeric[0].length;
        parse([...scopes, `${numeric[1]}::`], "::");
        continue;
      }
      if (char === "{" || char === "[") {
        flush();
        index++;
        parse([...scopes, char], char === "{" ? "}" : "]");
        continue;
      }
      // Parentheses are literal tag text, including commas (e.g. named characters).
      if (char === "(") {
        let depth = 0;
        do {
          const next = text[index++];
          leaf += next;
          if (next === "\\" && index < text.length) leaf += text[index++];
          else if (next === "(") depth++;
          else if (next === ")") depth--;
        } while (index < text.length && depth);
        if (depth) throw new Error("提示词括号不完整");
        continue;
      }
      if (char === "}" || char === "]" || text.startsWith("::", index))
        throw new Error("提示词权重结构不完整");
      if (char === "," || char === "，" || char === "\n" || char === "\r") {
        flush();
        index++;
        continue;
      }
      leaf += char;
      index++;
    }
    if (closing) throw new Error("提示词权重结构不完整");
    flush();
  }
  parse([]);
  return atoms;
}

export function assertPromptSubset(
  original: string,
  disclosed: string,
  label: string,
): void {
  if (disclosed.length > 20_000) throw new Error(`${label}不能超过 20000 字符`);
  const available = new Map<string, number>();
  for (const atom of promptAtoms(original))
    available.set(atom, (available.get(atom) || 0) + 1);
  for (const atom of promptAtoms(disclosed)) {
    if (!available.get(atom)) {
      const [, content] = JSON.parse(atom) as [string[], string];
      throw new Error(
        `${label}包含新增、改写、权重变化或重复增加的内容：${content.slice(0, 120)}`,
      );
    }
    available.set(atom, available.get(atom)! - 1);
  }
}

export function publicPublication(
  source: Record<string, unknown> | null,
  input: GalleryPublicationInput,
  exposeParameters: boolean,
) {
  if (
    input.promptMode !== undefined &&
    !["full", "partial", "hidden", "none"].includes(input.promptMode)
  )
    throw new Error("提示词公开方式无效");
  const readable = hasReadableGenerationMetadata(source);
  let mode: GalleryPromptMode =
    input.promptMode || (exposeParameters ? "full" : "hidden");
  if (!readable) {
    if (mode === "partial")
      throw new Error(
        "原始生成元数据不可读取，无法校验部分提示词；请选择无原数据投稿",
      );
    mode = "none";
  }
  const metadataState: GalleryMetadataState = readable ? "readable" : "missing";
  const noOriginalData = !readable || mode === "none";
  if (mode === "none" || mode === "hidden")
    return {
      promptMode: mode,
      metadataState,
      noOriginalData,
      prompt: "",
      negativePrompt: "",
      parameters: {} as Record<string, unknown>,
    };
  const original = imagePromptText(source!);
  if (mode === "full")
    return {
      promptMode: mode,
      metadataState,
      noOriginalData,
      ...original,
      parameters: structuredClone(source!),
    };
  const prompt = input.partialPrompt || "";
  const negativePrompt = input.partialNegativePrompt || "";
  assertPromptSubset(original.prompt, prompt, "正向提示词");
  assertPromptSubset(original.negativePrompt, negativePrompt, "负向提示词");
  const originalCharacters = readImageCharacterPrompts(source!);
  const characters = input.partialCharacters || [];
  if (!Array.isArray(characters) || characters.length > 6)
    throw new Error("角色提示词格式无效");
  const seen = new Set<number>();
  const characterPrompts = characters.map((character) => {
    if (
      !Number.isInteger(character.sourceIndex) ||
      seen.has(character.sourceIndex) ||
      !originalCharacters[character.sourceIndex]
    )
      throw new Error("角色提示词来源无效或重复");
    seen.add(character.sourceIndex);
    const origin = originalCharacters[character.sourceIndex];
    if (
      typeof character.prompt !== "string" ||
      typeof character.negativePrompt !== "string"
    )
      throw new Error("角色提示词必须是文本");
    assertPromptSubset(
      origin.prompt,
      character.prompt,
      `角色 ${character.sourceIndex + 1} 正向提示词`,
    );
    assertPromptSubset(
      origin.negativePrompt,
      character.negativePrompt,
      `角色 ${character.sourceIndex + 1} 负向提示词`,
    );
    return {
      prompt: character.prompt,
      negativePrompt: character.negativePrompt,
      center: origin.center,
    };
  });
  if (
    !prompt.trim() &&
    !negativePrompt.trim() &&
    !characterPrompts.some((c) => c.prompt.trim() || c.negativePrompt.trim())
  )
    throw new Error("部分公开内容不能为空，请选择不公开提示词");
  // Allowlist: never copy v4_prompt or any other embedded source aliases into a partial publication.
  const parameters: Record<string, unknown> = {
    prompt,
    negative_prompt: negativePrompt,
    characterPrompts,
  };
  return {
    promptMode: mode,
    metadataState,
    noOriginalData,
    prompt,
    negativePrompt,
    parameters,
  };
}

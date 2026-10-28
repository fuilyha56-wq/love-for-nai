/** Ported from Aaalice NAI Launcher's TextSpaceConverter / NaiPromptFormatter (MIT).
 * Source: lib/core/utils/{text_space_converter,nai_prompt_formatter,prompt_edit_document}.dart
 * License: public/nai/LICENSE-Aaalice.txt
 */
const NAI_PROTECTED_CHARACTERS = new Set([",", "，", "{", "}", "[", "]", "(", ")", "|", "<", ">"]);

/** Protect the nearest non-space characters and angle-bracket contents, as in Aaalice. */
export function convertNaiPromptSpaces(text: string): string {
  const nextNonSpace = new Int32Array(text.length);
  let next = -1;
  for (let index = text.length - 1; index >= 0; index--) {
    nextNonSpace[index] = next;
    if (text[index] !== " ") next = index;
  }
  const result: string[] = [];
  let previous = -1;
  let angleDepth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "<") angleDepth++;
    const inAngle = angleDepth > 0;
    if (char === ">") angleDepth = Math.min(100, Math.max(0, angleDepth - 1));
    if (char !== " ") {
      result.push(char);
      previous = index;
      continue;
    }
    const following = nextNonSpace[index];
    const protectedSpace = inAngle || (previous >= 0 && NAI_PROTECTED_CHARACTERS.has(text[previous]))
      || (following >= 0 && NAI_PROTECTED_CHARACTERS.has(text[following]));
    result.push(protectedSpace ? " " : "_");
  }
  return result.join("");
}

function formatLine(line: string): string {
  if (!line) return line;
  const leading = line.match(/^[ \t]*/)?.[0] || "";
  const trailing = line.match(/[ \t]*$/)?.[0] || "";
  const end = line.length - trailing.length;
  if (leading.length >= end) return line;
  const content = line.slice(leading.length, end).replaceAll("　", " ").replace(/[ \t\f\u00a0]+/g, " ").replaceAll("，", ",");
  const tags = content.split(",").map((tag) => tag.trim()).filter(Boolean).map(convertNaiPromptSpaces);
  let formatted = tags.join(", ");
  if (content.endsWith(",") && formatted) formatted += ",";
  return leading + formatted + trailing;
}

function formatPromptText(text: string): string {
  return text.split(/(\r\n|\r|\n)/).map((line) => /^[\r\n]+$/.test(line) ? line : formatLine(line)).join("");
}

/** Match Aaalice's top-level reserved negative(...) content ranges before formatting. */
function negativeContentRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let braces = 0, brackets = 0, parentheses = 0;
  const horizontal = (char: string) => /[ \t\f\u00a0]/.test(char);
  const boundary = (char: string | undefined) => char === undefined || char === "," || char === "\n" || char === "\r";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") { index++; continue; }
    if (!braces && !brackets && !parentheses && text.startsWith("negative(", index)) {
      let before = index - 1;
      while (before >= 0 && horizontal(text[before])) before--;
      if (boundary(text[before])) {
        let depth = 1;
        let close = index + "negative(".length;
        for (; close < text.length; close++) {
          if (text[close] === "\\") { close++; continue; }
          if (text[close] === "(") depth++;
          else if (text[close] === ")" && --depth === 0) break;
        }
        if (close >= text.length) { index += "negative".length; continue; }
        let after = close + 1;
        while (after < text.length && horizontal(text[after])) after++;
        if (boundary(text[after])) {
          ranges.push([index + "negative(".length, close]);
          index = close;
          continue;
        }
        continue;
      }
    }
    if (char === "{") braces++;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "[") brackets++;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "(") parentheses++;
    else if (char === ")") parentheses = Math.max(0, parentheses - 1);
  }
  return ranges;
}

function formatActiveText(text: string): string {
  let prepared = text;
  for (const [start, end] of negativeContentRanges(text).reverse()) {
    prepared = prepared.slice(0, start) + formatPromptText(prepared.slice(start, end)) + prepared.slice(end);
  }
  return formatPromptText(prepared);
}

/** Map only active text, preserving escaped and unfinished disabled payloads byte for byte. */
export function formatNaiPrompt(text: string): string {
  let cursor = 0;
  let followsDisabled = false;
  const result: string[] = [];
  const appendActive = (fragment: string) => {
    const separator = followsDisabled ? fragment.match(/^[ \t]*[,，][ \t]*/) : null;
    followsDisabled = true;
    result.push(separator ? separator[0].replaceAll("，", ",") + formatActiveText(fragment.slice(separator[0].length)) : formatActiveText(fragment));
  };
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\") { index++; continue; }
    if (!text.startsWith("/*disabled:", index)) continue;
    appendActive(text.slice(cursor, index));
    let end = -1;
    for (let scan = index + "/*disabled:".length; scan < text.length - 1; scan++) {
      if (text[scan] === "\\") { scan++; continue; }
      if (text.startsWith("*/", scan)) { end = scan + 2; break; }
    }
    if (end < 0) return result.join("") + text.slice(index);
    result.push(text.slice(index, end));
    cursor = end;
    index = end - 1;
  }
  appendActive(text.slice(cursor));
  return result.join("");
}

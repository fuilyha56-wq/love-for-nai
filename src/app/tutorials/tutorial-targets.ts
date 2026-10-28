import type { TutorialArea, TutorialStep } from "@/lib/feature-tutorials";

const targets: Record<TutorialArea, string> = {
  model: '[data-layout-module="model"], .replica-model-controls, .rgs-model-controls, .mobile-studio-mode-selector',
  mode: '.mobile-studio-mode-selector, .studio-mode-picker',
  prompt: '[data-tutorial="prompt"], [data-layout-module="prompt"], .replica-prompt, .mobile-studio-prompt-content, .studio-prompt-panel',
  size: '[data-layout-module="image"], .replica-image-size, .rgs-image-size, .mobile-studio-sheet-content',
  sampling: '[role="dialog"][aria-label="生成参数设置"], [data-tutorial="sampling"], [data-layout-module="sampling"], .nai-inline-generation-parameters, .mobile-studio-sheet-content',
  reference: '[data-layout-module="references"], [data-layout-module="operations"], .mobile-studio-reference-panel, .replica-nai-reference, .replica-controls-scroll',
  source: '.mobile-studio-reference-panel, [data-tutorial="source"], [data-layout-module="operations"], .replica-controls-scroll, [data-layout-module="references"]',
  characters: '.replica-character-section, .replica-characters, [data-layout-module="prompt"], .mobile-studio-prompt-content',
  generate: '[data-layout-module="generate"]',
  result: '.mobile-studio-preview-section, .replica-media, [data-layout-module="canvas"]',
  assistant: '.mobile-studio-assistant-content, [data-layout-module="agent"], .replica-reverse-tagger',
  "editor-tools": '.editor-left-panel, .editor-mobile-sheet-body',
  "editor-canvas": '.editor-stage',
  "editor-params": '[data-tutorial="editor-params"], .editor-mobile-sheet-body',
  "editor-files": '[data-tutorial="editor-files"], .editor-mobile-sheet-body',
  "editor-actions": '.editor-actions',
  page: '.workspace-page, .settings-content, .profile-content',
};

export function tutorialElementVisible(element: Element) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && rect.left < innerWidth && rect.right > 0;
}

export function findTutorialStepAction(step: TutorialStep, nextStep?: TutorialStep) {
  if (step.path !== "/image" || !nextStep?.path.startsWith("/image/editor") || !document.querySelector('[data-tutorial-source-ready="true"]')) return undefined;
  const mode = new URL(nextStep.path, window.location.origin).searchParams.get("mode");
  // Match the editor mode the next step actually opens. Falling back from
  // canvas to inpaint made desktop outpaint instructions point at the wrong
  // button. On mobile the only editor entry can be the repaint-mask button;
  // the tutorial then tells the user to switch to canvas inside the editor.
  const mobileCanvasEntry = mode !== "inpaint" && innerWidth < 1024 && Boolean(document.querySelector(".mobile-studio-launcher"));
  const entries = mode === "inpaint" ? ["inpaint"] : mobileCanvasEntry ? ["canvas", "inpaint"] : ["canvas"];
  for (const entry of entries) {
    const element = [...document.querySelectorAll<HTMLButtonElement>(`button[data-tutorial-editor="${entry}"]`)]
      .find((button) => !button.disabled && tutorialElementVisible(button));
    if (element) return { element, label: element.textContent?.trim() || element.getAttribute("aria-label") || "图像编辑器" };
  }
  return undefined;
}

export function findTutorialTarget(step: TutorialStep, nextStep?: TutorialStep): HTMLElement | undefined {
  const action = findTutorialStepAction(step, nextStep);
  if (action) return action.element;
  const isEditorEntry = step.path === "/image" && nextStep?.path.startsWith("/image/editor");
  const sourceReady = Boolean(document.querySelector('[data-tutorial-source-ready="true"]'));
  // Before upload, point back to the source area even when this step's final
  // target is a specific editor button. That button is disabled until ready.
  const selector = isEditorEntry && !sourceReady ? targets[step.area] : step.target || targets[step.area];
  const elements = selector.split(",").flatMap((item) => [...document.querySelectorAll<HTMLElement>(item.trim())]).filter(tutorialElementVisible);
  // Prefer the live mobile panel to a mounted but covered studio control.
  return elements.find((element) => element.closest('.mobile-studio-workspace-dialog')) || elements[0];
}

function revealEditorEntry(nextStep?: TutorialStep) {
  if (!nextStep?.path.startsWith("/image/editor")) return;
  const mode = new URL(nextStep.path, window.location.origin).searchParams.get("mode");
  const mobileCanvasEntry = mode !== "inpaint" && innerWidth < 1024 && Boolean(document.querySelector(".mobile-studio-launcher"));
  const entries = mode === "inpaint" ? ["inpaint"] : mobileCanvasEntry ? ["canvas", "inpaint"] : ["canvas"];
  for (const entry of entries) for (const candidate of document.querySelectorAll<HTMLButtonElement>(`button[data-tutorial-editor="${entry}"]`)) {
    const section = candidate.closest<HTMLElement>(".replica-section");
    const sectionToggle = section?.querySelector<HTMLButtonElement>(".replica-section-heading button[aria-expanded='false']");
    if (sectionToggle && tutorialElementVisible(sectionToggle)) sectionToggle.click();

    const collapsedModule = candidate.closest<HTMLElement>('[data-layout-collapsed="true"]');
    const moduleToggle = collapsedModule?.querySelector<HTMLButtonElement>('button[aria-expanded="false"], .panel-section-head[aria-expanded="false"]');
    if (moduleToggle && tutorialElementVisible(moduleToggle)) moduleToggle.click();

    const closedDetails = candidate.closest<HTMLDetailsElement>("details:not([open])");
    if (closedDetails) closedDetails.open = true;
  }
}

function clickVisible(selector: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((element) => tutorialElementVisible(element) && !element.disabled);
  button?.click();
  return Boolean(button);
}

/** Only opens panels. Uploads, form changes, generation and publishing stay with the user. */
export function revealTutorialTarget(step: TutorialStep, nextStep?: TutorialStep) {
  // The editor entry may live inside a collapsed reference subsection. Open
  // the subsection containing the mode-specific button before measuring it.
  revealEditorEntry(nextStep);
  const mobile = Boolean(document.querySelector('.mobile-studio-launcher'));
  if (mobile) {
    const pane = ["model", "size", "sampling"].includes(step.area) ? "parameters" : ["prompt", "characters"].includes(step.area) ? "prompt" : step.area === "assistant" ? "assistant" : null;
    const active = document.querySelector('.mobile-studio-workspace-dialog [data-workspace-pane]:not([hidden])')?.getAttribute('data-workspace-pane');
    if (pane && active !== pane) {
      if (pane === "prompt") clickVisible('.mobile-studio-prompt-toggle, .mobile-studio-workspace-switch button:first-child');
      if (pane === "parameters") clickVisible('button[aria-label="打开生成参数"], .mobile-studio-workspace-switch button:nth-child(2)');
      if (pane === "assistant") clickVisible('button[aria-label="打开标签助手"], .mobile-studio-workspace-switch button:nth-child(3)');
    } else if (!pane && active) clickVisible('.mobile-studio-prompt-actions button:last-child');
  } else if (step.area === "sampling" || (step.area === "model" && !findTutorialTarget(step))) {
    if (!document.querySelector('[role="dialog"][aria-label="生成参数设置"]:not([inert])')) clickVisible('button[aria-label="生成参数"]');
  }
  if (step.area === "reference" || step.area === "source") {
    // The legacy desktop layout starts with its reference section collapsed.
    if (step.area === "reference" || !document.querySelector('[data-tutorial="source"]')) clickVisible('[data-layout-module="references"] .panel-section-head[aria-expanded="false"]');
    if (step.area === "source") clickVisible('.replica-section[data-tutorial="source"] .replica-section-heading button[aria-expanded="false"]');
    if (step.target?.includes('data-tutorial="vibe"')) clickVisible('.replica-section[data-tutorial="vibe"] .replica-section-heading button[aria-expanded="false"]');
    if (step.target?.includes('data-tutorial="precise"')) clickVisible('.replica-section[data-tutorial="precise"] .replica-section-heading button[aria-expanded="false"]');
  }
  if (step.path.startsWith("/image/editor")) {
    const sheet = step.area === "editor-tools" ? "工具" : step.area === "editor-params" ? "生成" : step.area === "editor-files" ? "画布" : null;
    if (sheet) {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.editor-mobile-tabs button')].find((item) => item.textContent?.trim() === sheet && tutorialElementVisible(item));
      if (button && !button.classList.contains('is-active')) button.click();
    }
    if (step.area === "editor-params" || step.area === "editor-files") {
      const details = document.querySelector<HTMLDetailsElement>(`[data-tutorial="${step.area}"]`);
      if (details) details.open = true;
      if (!document.querySelector('.editor-right-panel')) clickVisible('button[aria-label="展开生成参数"]');
    }
  }
}

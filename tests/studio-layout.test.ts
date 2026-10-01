import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE_PREFERENCES } from "@/lib/appearance-store";
import { balancePreview } from "@/app/image/balance-preview";
import { NaiBalanceMeter } from "@/app/image/nai-balance-meter";

const appearance = vi.hoisted(() => ({ theme: "paper", workspaceLayout: "lfn" }));
vi.mock("@/app/appearance", () => ({
  useAppearance: () => ({ preferences: { ...DEFAULT_APPEARANCE_PREFERENCES, theme: appearance.theme, workspaceLayout: appearance.workspaceLayout } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import ImageStudio from "@/app/image/studio";

function renderStudio(theme: string, workspaceLayout = "lfn", layoutEditor = false) {
  appearance.theme = theme;
  appearance.workspaceLayout = workspaceLayout;
  return renderToStaticMarkup(createElement(ImageStudio, { userName: "体验用户", authenticated: false, layoutEditor }));
}

// The canvas and right dock contain nested sections/asides. Keep their full SSR
// subtrees so absence checks cannot pass because a nested closing tag cut them off.
function elementMarkup(html: string, tag: string, marker: string): string {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker}`);
  const tags = new RegExp(`</?${tag}\\b[^>]*>`, "g");
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  throw new Error(`Unclosed ${marker}`);
}

function studioCanvas(html: string): string {
  return elementMarkup(html, "section", '<section class="studio-canvas');
}

function studioLeft(html: string): string {
  return elementMarkup(html, "aside", '<aside class="studio-controls-panel');
}

function studioTools(html: string): string {
  return elementMarkup(html, "aside", '<aside class="studio-tools-panel');
}

function expectOriginalFeatureLinks(html: string) {
  const navigation = html.includes('<nav class="tools-icon-rail"')
    ? elementMarkup(html, "nav", '<nav class="tools-icon-rail"')
    : elementMarkup(html, "div", '<div class="studio-custom-nav');
  for (const [href, label] of [
    ["/stories", "故事工作台"], ["/history", "图片历史"],
    ["/gallery", "图片广场"], ["/usage", "使用记录"],
    ["/account", "我的账号"], ["/settings#models", "模型密钥"],
    ["/announcements", "公告"], ["/settings", "外观设置"],
  ]) {
    const link = navigation.match(new RegExp(`<a\\b[^>]*href="${href}"[^>]*>[\\s\\S]*?</a>`))?.[0];
    expect(link, `${label} should retain its destination`).toBeDefined();
    expect(link).toContain(label);
  }
}

function expectReplicaCanvas(canvas: string, variant: "nai" | "nlw") {
  expect(canvas).toContain(`class="replica-media replica-media-${variant}"`);
  expect(canvas).toContain('aria-label="生成结果预览"');
  expect(canvas).toContain("图像将在这里显示");
  expect(canvas).not.toContain("<textarea");
  expect(canvas).not.toContain('aria-label="提示词编辑器"');
  expect(canvas).not.toContain('class="replica-character-section');
  expect(canvas).not.toContain('data-layout-module="generate"');
  expect(canvas).not.toContain('class="replica-run-button"');
  expect(canvas).not.toContain("执行生成");
}

function expectCollapsedTools(tools: string) {
  expect(tools).toMatch(/^<aside class="studio-tools-panel[^\"]* is-replica-dock"/);
  expect(tools).toContain('class="replica-right-dock is-collapsed"');
  expect(tools).toContain('aria-label="展开历史记录"');
  expect(tools).toContain('aria-label="展开聊天"');
  expect(tools).toContain('class="replica-dock-workspace" hidden=""');
  expect(tools).toContain('aria-label="标签助手输入"');
  expect(tools).not.toContain('class="right-dock-rail"');
  expect(tools).not.toContain('aria-label="调整助手面板高度"');
}

describe("工作台布局按主题隔离", () => {
  it.each(["paper", "dusk", "night"])("LFN %s 保留原有品牌、功能入口、参数和三栏结构", (theme) => {
    const html = renderStudio(theme);
    const left = studioLeft(html);
    const canvas = studioCanvas(html);
    const tools = studioTools(html);
    expect(html).toContain('data-studio-layout="classic"');
    expect(html).toContain('data-workspace-layout="lfn"');
    expect(html).toContain('data-aaalice-dock="true"');
    expect(html).toContain('--lfn-right:40px');
    expect(html).toContain('class="studio-layout grid min-h-0 flex-1"');
    expect(html).toContain("--lfn-left:310px");
    expect(html).toContain('aria-label="返回 Love for NAI 首页"');
    expect(html).toContain('title="源代码与 AGPL-3.0"');
    expect(html).toContain('title="打开 NewAPI 控制台"');
    expect(html).toContain('title="我的账号：资料、钱包、签到与邀请"');
    expect(left).not.toContain("<textarea");
    expect(left).toContain('aria-label="采样步数"');
    expect(left).not.toContain('aria-label="打开站内菜单"');
    expect(canvas).toContain("<textarea");
    expect(canvas).toContain("描述画面");
    expect(canvas).toContain("排除内容");
    const generate = elementMarkup(canvas, "div", '<div class="flex shrink-0 items-center gap-3 border-t');
    expect(generate).toContain("<button");
    expect(generate).toContain("生成 1 张图像");
    // e134 preserves the original destinations in the left icon rail.
    expect(html).toContain('aria-label="功能入口"');
    expect(html).toContain('data-label="图片广场"');
    expectOriginalFeatureLinks(html);
    expectCollapsedTools(tools);
    expect(html).not.toContain('class="nai-generation-footer"');
    expect(html).not.toContain('data-replica-studio=');
    expect(html).not.toContain('class="replica-controls"');
    expect(html).not.toContain('class="replica-generation-footer"');
    expect(html).not.toContain('class="replica-navigation"');
    expect(canvas).not.toContain('class="replica-media');
    expect(left.indexOf("导入图片")).toBeLessThan(left.indexOf('aria-label="模型"'));
    expect(left.indexOf('aria-label="采样步数"')).toBeLessThan(left.indexOf("生成张数"));
    expect(left.indexOf("生成张数")).toBeLessThan(left.indexOf("多角色"));
  });

  it.each(["paper", "dusk", "night"])("NLW %s 使用400px左栏、导航和独立历史/聊天停靠栏", (theme) => {
    const html = renderStudio(theme, "nlw");
    const left = studioLeft(html);
    const canvas = studioCanvas(html);
    const tools = studioTools(html);
    const scroll = elementMarkup(left, "div", '<div class="replica-controls-scroll"');
    const footer = elementMarkup(left, "footer", '<footer class="replica-generation-footer"');
    const navigation = elementMarkup(html, "nav", '<nav class="replica-navigation"');
    expect(html).toContain('data-workspace-layout="nlw"');
    expect(html).toContain('data-replica-studio="nlw"');
    expect(html).toContain("--lfn-left:400px");
    expect(html).toContain("--lfn-right:40px");
    expect(html).toContain('aria-label="调整左侧面板宽度" aria-valuenow="400"');
    expect(html).not.toContain('aria-label="返回 Love for NAI 首页"');
    expect(navigation).toContain('aria-label="工作台导航"');
    expect(navigation).toContain('aria-label="图片库"');
    expect(navigation).toContain('href="/gallery"');
    const appearanceLink = navigation.match(/<a\b[^>]*aria-label="外观设置"[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(appearanceLink).toContain('href="/settings#appearance"');
    expect(navigation).not.toContain('href="/image/setting/layout"');
    expect(left).toContain('aria-label="收起参数栏"');
    expect(html).not.toContain('data-left-collapsed="true"');
    expect(left).toContain('class="replica-controls" data-variant="nlw"');
    expect(scroll).toContain('class="rgs-image-size" data-replica-variant="nlw"');
    expect(scroll).toContain("常规 - 竖屏 (832×1216)");
    expect(scroll).toContain('aria-label="种子"');
    expect(scroll).toContain('aria-label="锁定种子" aria-pressed="false"');
    expect(scroll).toContain('aria-label="提示词编辑器"');
    expect(scroll).toContain('role="tablist" aria-label="提示词类型"');
    expect(scroll).toContain('class="replica-prompt-tabs"');
    expect(scroll).not.toContain('class="replica-nai-prompt-cards"');
    expect(scroll.match(/class="replica-character-section"/g)).toHaveLength(1);
    expect(scroll).toContain('aria-label="展开角色" aria-expanded="false"');
    expect(scroll.match(/class="replica-section"/g)).toHaveLength(4);
    expect(scroll.match(/class="replica-section-heading"[\s\S]*?<button[^>]*aria-expanded="false"/g)).toHaveLength(4);
    for (const title of ["反推", "图生图", "风格迁移", "精准参考"]) expect(scroll).toContain(title);
    expect(scroll.match(/class="replica-section-motion" aria-hidden="true" inert=""/g)).toHaveLength(4);
    expect(scroll).toContain('class="replica-character-motion" aria-hidden="true" inert=""');
    expect(scroll).not.toContain("多角色");
    expect(scroll).not.toContain('class="replica-generation-footer"');
    expect(left.indexOf(footer)).toBeGreaterThan(left.indexOf(scroll) + scroll.length);
    expect(footer).toContain('data-replica-footer="nlw"');
    expect(footer).toContain('class="rgs-nlw-summary"');
    expect(footer).toContain('class="rgs-model-name"');
    expect(footer).toContain('aria-label="生成参数" aria-expanded="false"');
    expect(footer).toContain('class="replica-generation-meta"');
    expect(footer).toContain('class="replica-batch-label">分批');
    expect(footer).toContain('class="replica-run-button"');
    expect(footer).not.toContain('aria-label="采样步数"');
    expect(footer).not.toContain('class="rgs-panel"');
    expect(footer).not.toContain('class="rgs-summary"');
    expect(tools).toContain("is-replica-dock");
    expect(tools).toContain('aria-label="聊天与历史停靠栏"');
    expect(tools).toContain('class="replica-right-dock is-collapsed"');
    const rail = elementMarkup(tools, "div", '<div class="replica-dock-rail"');
    expect(rail).toContain('aria-label="展开聊天"');
    expect(rail).toContain('aria-label="展开历史记录"');
    expect(rail.indexOf('aria-label="展开聊天"')).toBeLessThan(rail.indexOf('aria-label="展开历史记录"'));
    expect(tools).not.toContain('aria-expanded="true"');
    const history = elementMarkup(tools, "section", '<section class="replica-dock-pane replica-dock-history"');
    expect(history).toContain('aria-expanded="false"');
    expect(history).toContain('aria-label="展开历史记录"');
    expect(history).toMatch(/class="replica-dock-content"[^>]*hidden=""/);
    const assistant = elementMarkup(tools, "section", '<section class="replica-dock-pane replica-dock-assistant"');
    expect(assistant).toContain('aria-expanded="false"');
    expect(assistant).toContain('aria-label="展开聊天"');
    expect(assistant).toMatch(/class="replica-dock-content"[^>]*hidden=""/);
    expect(tools).not.toContain('aria-label="调整历史与聊天高度"');
    expect(tools).not.toContain("创作中心");
    expect(html).not.toContain('class="replica-controls" data-variant="nai"');
    expectReplicaCanvas(canvas, "nlw");
  });

  it.each(["lfn", "nlw"])("NAI 在%s偏好下保持447px独立布局和底部摘要", (workspaceLayout) => {
    const html = renderStudio("nai", workspaceLayout);
    const left = studioLeft(html);
    const canvas = studioCanvas(html);
    const tools = studioTools(html);
    const controls = elementMarkup(left, "div", '<div class="replica-controls"');
    const scroll = elementMarkup(controls, "div", '<div class="replica-controls-scroll"');
    const footer = elementMarkup(left, "footer", '<footer class="replica-generation-footer"');
    expect(html).toContain('data-studio-layout="nai"');
    expect(html).toContain('data-replica-studio="nai"');
    expect(html).not.toContain('data-workspace-layout=');
    expect(html).not.toContain('aria-label="返回 Love for NAI 首页"');
    expect(controls).toContain('data-variant="nai"');
    expect(controls).toContain('aria-label="打开站内菜单"');
    expect(scroll).toContain('class="replica-model-controls"');
    expect(scroll).toContain('aria-label="模型"');
    expect(scroll).toContain('aria-label="提示词编辑器"');
    expect(scroll).toContain('class="replica-nai-prompt-card positive"');
    expect(scroll.match(/class="replica-nai-prompt-card /g)).toHaveLength(1);
    expect(scroll.match(/<textarea\b/g)).toHaveLength(1);
    const promptTabs = elementMarkup(scroll, "div", '<div class="replica-nai-prompt-tabs"');
    expect(promptTabs).toContain('role="tablist" aria-label="提示词类型"');
    expect(promptTabs).toMatch(/role="tab" aria-selected="true"[^>]*class="positive is-selected"[^>]*>提示词<\/button>/);
    expect(promptTabs).toMatch(/role="tab" aria-selected="false"[^>]*class="negative"[^>]*>UC<\/button>/);
    expect(scroll).toContain('aria-label="选择质量词"');
    expect(scroll).toContain('class="rgs-image-size" data-replica-variant="nai"');
    expect(scroll).toContain('aria-label="图片宽度"');
    expect(scroll).toContain('aria-label="图片高度"');
    expect(scroll).toContain('aria-label="交换宽高"');
    expect(scroll).toContain('aria-label="画面方向"');
    expect(scroll).toContain('aria-label="生成张数快捷选择"');
    expect(scroll).toContain("自定义张数");
    expect(scroll.match(/class="replica-character-section"/g)).toHaveLength(1);
    expect(controls).not.toContain('class="replica-generation-footer"');
    expect(scroll).not.toContain('aria-label="采样步数"');
    expect(left.indexOf(footer)).toBeGreaterThan(left.indexOf(controls) + controls.length - 1);
    expect(footer).toContain('data-replica-footer="nai"');
    expect(footer).toContain('class="rgs-summary"');
    expect(footer).toContain('aria-label="采样步数"');
    expect(footer).toContain('aria-label="提示引导"');
    expect(footer).toContain('aria-label="生成参数" aria-expanded="false"');
    expect(footer).toContain('class="replica-run-button"');
    expect(footer).not.toContain('class="rgs-panel"');
    expect(footer).not.toContain('class="rgs-nlw-summary"');
    expect(html).not.toContain('class="replica-navigation"');
    expect(tools).toContain("is-replica-dock");
    expect(tools).toContain('class="replica-right-dock is-collapsed"');
    expect(tools).toContain('aria-label="展开历史记录"');
    expect(tools).toContain('aria-label="展开聊天"');
    expect(tools).toContain('data-replica-history');
    expect(tools).not.toContain("session-history-panel");
    expect(tools).not.toContain("is-overlay");
    expect(tools.slice(0, tools.indexOf(">") + 1)).not.toContain('aria-hidden="true"');
    expect(canvas).not.toContain('aria-label="打开历史与标签助手"');
    expect(html).toContain("--lfn-right:40px");
    expect(html).toContain('aria-label="调整右侧面板宽度" aria-valuenow="280"');
    expect(html).not.toContain("创作中心");
    expect(html).toContain("--lfn-left:447px");
    expect(html).toContain('aria-label="调整左侧面板宽度" aria-valuenow="447"');
    expectReplicaCanvas(canvas, "nai");
  });

  it.each(["paper", "nai"])("%s自定义布局复用官网控件、折叠自然高度和固定画布，右栏默认收起", (theme) => {
    const html = renderStudio(theme, "custom");
    const left = studioLeft(html);
    const canvas = studioCanvas(html);
    const tools = studioTools(html);
    expect(html).toContain('data-workspace-layout="custom"');
    expect(html).toContain('data-aaalice-dock="true"');
    expect(html).toContain('--lfn-right:40px');
    expect(html).toContain('class="studio-layout grid min-h-0 flex-1 is-custom-layout"');
    expect(html).toContain('class="layout-editor-entry" href="/image/setting/layout"');
    expectOriginalFeatureLinks(html);
    for (const moduleId of ["prompt", "model", "image", "sampling", "references", "operations"]) {
      const moduleMarkup = elementMarkup(left, "div", `<div data-layout-module="${moduleId}"`);
      // v3 height units set a minimum within the column, without moving it onto a grid.
      expect(moduleMarkup.match(/^<div\b[^>]*>/)?.[0]).toContain("min-height:104px");
    }
    const director = elementMarkup(left, "div", '<div data-layout-module="director"');
    expect(director).toContain('data-layout-collapsed="true"');
    expect(director.match(/^<div\b[^>]*>/)?.[0]).toContain("min-height:0");
    expect(director).not.toContain('class="panel-section-body"');
    const promptCard = elementMarkup(left, "div", '<div data-layout-module="prompt"');
    expect(promptCard).toContain('class="replica-nai-prompt-tabs"');
    expect(promptCard).toContain('aria-label="收起提示词"');
    expect(promptCard.match(/<textarea\b/g)).toHaveLength(1);
    expect(promptCard).toContain('class="replica-character-section"');
    expect(left).toContain('class="rgs-image-size" data-replica-variant="nai"');
    expect(left).toContain('aria-label="生成张数快捷选择"');
    expect(left).toContain('aria-label="生成参数" aria-expanded="false"');
    expect(left).not.toContain('class="rgs-panel"');
    expect(canvas).toContain('data-layout-module="canvas"');
    expect(canvas.match(/^<section\b[^>]*>/)?.[0]).not.toContain("style=");
    const generate = elementMarkup(left, "footer", '<footer class="replica-generation-footer"');
    expect(generate).toContain('data-layout-module="generate"');
    expect(generate.match(/^<footer\b[^>]*>/)?.[0]).not.toContain("style=");
    expect(generate).toContain('aria-label="切换提交方式"');
    expect(html).not.toContain("grid-column:");
    expect(html).not.toContain("grid-row:");
    expect(html).not.toContain('data-layout-drag=');
    expectCollapsedTools(tools);
    const assistant = elementMarkup(tools, "div", '<div data-layout-module="agent"');
    expect(assistant.match(/^<div\b[^>]*>/)?.[0]).not.toContain("min-height:");
    expect(html).not.toContain('data-replica-studio=');
    expect(html).not.toContain('class="replica-controls"');
    expect(canvas).not.toContain("<textarea");
    expect(left).toContain("<textarea");
  });

  it("编辑模式只允许九个有效控件和工具模块移动，画布与生成区固定", () => {
    const html = renderStudio("paper", "custom", true);
    const tools = studioTools(html);
    const movable = [...html.matchAll(/data-layout-drag="([^\"]+)"/g)].map(match => match[1]);
    expect(movable.sort()).toEqual(["prompt", "model", "image", "sampling", "references", "operations", "history", "agent", "director"].sort());
    expect(html).toContain('data-layout-editor-board="true"');
    expect(html).not.toContain('data-aaalice-dock=');
    expect(tools).not.toContain('class="replica-right-dock');
    expect(html).not.toContain("grid-column:");
    expect(html).not.toContain("grid-row:");
    expect(tools).not.toContain('aria-label="停靠面板入口"');
    expect(tools).toContain('data-layout-module="history"');
    expect(tools).toContain('aria-label="标签助手输入"');
  });

});

describe("真实余额进度条", () => {
  it("根据本次费用计算剩余比例，不假设历史充值上限", () => {
    expect(balancePreview(100, 20)).toEqual({ available: 100, required: 20, remaining: 80, percent: 80, insufficient: false });
    expect(balancePreview(0, 2)?.percent).toBe(0);
    expect(balancePreview(5, 20)).toMatchObject({ remaining: 0, percent: 0, insufficient: true });
    expect(balancePreview(20, 0)?.percent).toBe(100);
    expect(balancePreview(null, 2)).toBeNull();
    expect(balancePreview(NaN, 2)).toBeNull();
    expect(balancePreview(10, Infinity)).toBeNull();
  });
  it("AFF 与 NewAPI 使用各自单位与真实剩余额度", () => {
    const aff = renderToStaticMarkup(createElement(NaiBalanceMeter, { signedIn: true, unit: "AFF", balance: 100, cost: 20 }));
    expect(aff).toContain('aria-valuenow="80"');
    expect(aff).toContain("预计消耗 20 AFF，剩余 80 AFF");
    const usd = renderToStaticMarkup(createElement(NaiBalanceMeter, { signedIn: true, unit: "USD", balance: 2, cost: 0.5 }));
    expect(usd).toContain('aria-valuenow="75"');
    expect(usd).toContain("预计消耗 $0.50，剩余 $1.50");
  });
  it("未登录、余额或价格缺失不显示假的百分比", () => {
    for (const props of [
      { signedIn: false, balance: 100, cost: 2 },
      { signedIn: true, balance: null, cost: 2 },
      { signedIn: true, balance: 100, cost: null },
    ]) {
      const html = renderToStaticMarkup(createElement(NaiBalanceMeter, { ...props, unit: "AFF" }));
      expect(html).not.toContain('role="progressbar"');
    }
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplicaRightDock, resolveDockSplit } from "@/app/image/replica-right-dock";
import { createReplicaDockState, normalizeReplicaDockState, reduceReplicaDock, resolveAvailableReplicaDockState, resolveDockColumns, resolveReplicaDockLayout } from "@/lib/replica-dock";

describe("历史与聊天独立停靠", () => {
  it("聊天与历史默认收起，上下恢复入口使用逐字竖排并保留已挂载的内容", () => {
    const html = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "当前历史", assistant: "聊天草稿" }));
    expect(html).toContain('class="replica-right-dock is-collapsed"');
    const rail = html.match(/<div class="replica-dock-rail">([\s\S]*?)<\/div>/)?.[1];
    expect(rail).toBeDefined();
    expect(rail!.indexOf('aria-label="展开聊天"')).toBeLessThan(rail!.indexOf('aria-label="展开历史记录"'));
    expect(rail).toContain('class="replica-dock-rail-label" aria-hidden="true"><span>聊</span><span>天</span>');
    expect(rail).toContain('class="replica-dock-rail-label" aria-hidden="true"><span>历</span><span>史</span>');
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).toMatch(/class="replica-dock-panels" hidden=""/);
    expect(html.match(/class="replica-dock-content"[^>]*hidden=""/g)).toHaveLength(2);
    expect(html).toContain("当前历史");
    expect(html).toContain("聊天草稿");
    expect(html).not.toContain("tools-panel-collapse");
    expect(html).not.toContain('role="separator"');
  });

  it("初始聊天请求只展开聊天，历史保持独立收起", () => {
    const html = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "当前历史", assistant: "聊天草稿", assistantOpenRequest: 1 }));
    expect(html).not.toContain('class="replica-right-dock is-collapsed"');
    expect(html).toContain('class="replica-dock-pane replica-dock-assistant is-open"');
    expect(html).toContain('aria-label="收起聊天"');
    expect(html).toContain('aria-label="展开历史记录"');
    expect(html).not.toContain('class="replica-dock-pane replica-dock-history is-open"');
    expect(html.match(/class="replica-dock-content"[^>]*hidden=""/g)).toHaveLength(1);
    expect(html).not.toContain('role="separator"');
  });

  it("移动抽屉可初始展开历史，聊天保持收起且无分割条", () => {
    const html = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "当前历史", assistant: "聊天草稿", initialHistoryOpen: true }));
    expect(html).not.toContain('class="replica-right-dock is-collapsed"');
    expect(html).toContain('class="replica-dock-pane replica-dock-history is-open"');
    expect(html).toContain('aria-label="收起历史记录"');
    expect(html).toContain('aria-label="展开聊天"');
    expect(html).not.toContain('class="replica-dock-pane replica-dock-assistant is-open"');
    expect(html.match(/class="replica-dock-content"[^>]*hidden=""/g)).toHaveLength(1);
    expect(html).not.toContain('role="separator"');
  });

  it("初始历史与聊天请求可同时展开，并显示可访问的分割条", () => {
    const html = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "当前历史", assistant: "聊天草稿", initialHistoryOpen: true, assistantOpenRequest: 1 }));
    expect(html).toContain('class="replica-dock-pane replica-dock-history is-open"');
    expect(html).toContain('class="replica-dock-pane replica-dock-assistant is-open"');
    expect(html).toContain('class="replica-dock-panels is-split"');
    expect(html).not.toMatch(/class="replica-dock-content"[^>]*hidden=""/);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="调整历史与聊天高度"');
  });

  it("分割先为8px拖动条留空间，再限制历史160px与聊天280px", () => {
    expect(resolveDockSplit(10, 700)).toEqual({ historyHeight: 160, assistantHeight: 532 });
    expect(resolveDockSplit(600, 700)).toEqual({ historyHeight: 412, assistantHeight: 280 });
    expect(resolveDockSplit(300, 700)).toEqual({ historyHeight: 300, assistantHeight: 392 });
  });

  it("小窗口按两块最小高度比例回退，不产生负高度或挤出容器", () => {
    const split = resolveDockSplit(200, 300);
    expect(split.historyHeight + split.assistantHeight + 8).toBe(300);
    expect(split.historyHeight / split.assistantHeight).toBeCloseTo(160 / 280);
    expect(resolveDockSplit(100, 8)).toEqual({ historyHeight: 0, assistantHeight: 0 });
    expect(resolveDockSplit(NaN, Infinity)).toEqual({ historyHeight: 0, assistantHeight: 0 });
  });

  it("独占切换只呈现选中的面板，折叠后再次打开另一个面板", () => {
    const initial = createReplicaDockState();
    const history = reduceReplicaDock(initial, { type: "reveal", pane: "history" });
    expect(resolveReplicaDockLayout(history, 280)).toMatchObject({ historyOpen: true, assistantOpen: false });
    const assistant = reduceReplicaDock(history, { type: "reveal", pane: "assistant" });
    expect(resolveReplicaDockLayout(assistant, 280)).toMatchObject({ historyOpen: false, assistantOpen: true });
    const collapsed = reduceReplicaDock(assistant, { type: "collapse", pane: "assistant" });
    expect(collapsed.expanded).toBe(false);
    expect(resolveReplicaDockLayout(reduceReplicaDock(collapsed, { type: "reveal", pane: "history" }), 280).historyOpen).toBe(true);
  });

  it("分栏折叠一块留下恢复条，折叠最后一块回到双入口，恢复折叠块后两块都展开", () => {
    const stacked = reduceReplicaDock(createReplicaDockState(true), { type: "mode", mode: "stacked" });
    const folded = reduceReplicaDock(stacked, { type: "collapse", pane: "history" });
    expect(resolveReplicaDockLayout(folded, 280)).toMatchObject({ historyOpen: false, assistantOpen: true, restorePane: "history" });
    const collapsed = reduceReplicaDock(folded, { type: "collapse", pane: "assistant" });
    expect(collapsed.expanded).toBe(false);
    const restored = reduceReplicaDock(collapsed, { type: "reveal", pane: "history" });
    expect(resolveReplicaDockLayout(restored, 280)).toMatchObject({ historyOpen: true, assistantOpen: true, restorePane: null });
  });

  it("左右分栏至少预留历史200、聊天240与8像素分隔；窄栏回退上下且保留模式", () => {
    const state = reduceReplicaDock(createReplicaDockState(true), { type: "mode", mode: "side-by-side" });
    expect(resolveReplicaDockLayout(state, 447).horizontal).toBe(false);
    expect(resolveReplicaDockLayout(state, 448).horizontal).toBe(true);
    expect(resolveDockColumns(360, 520)).toEqual({ historyWidth: 200, assistantWidth: 312 });
    expect(resolveDockColumns(20, 520)).toEqual({ historyWidth: 272, assistantWidth: 240 });
    expect(resolveDockColumns(360, 448)).toEqual({ historyWidth: 200, assistantWidth: 240 });
  });

  it("改变布局会恢复两块分栏，保留此前调整的比例", () => {
    let state = reduceReplicaDock(createReplicaDockState(true, true), { type: "split", historyFraction: .62, chatWidth: 290 });
    state = reduceReplicaDock(state, { type: "collapse", pane: "history" });
    state = reduceReplicaDock(state, { type: "mode", mode: "side-by-side" });
    expect(state).toMatchObject({ foldedPane: null, historyFraction: .62, chatWidth: 290 });
  });

  it("浮出聊天后右栏只呈现历史，关闭浮窗不会收起历史，停靠恢复聊天", () => {
    const floating = reduceReplicaDock(createReplicaDockState(true, true), { type: "float" });
    expect(resolveReplicaDockLayout(floating, 520)).toMatchObject({ horizontal: false, historyOpen: true, assistantOpen: true });
    const hidden = reduceReplicaDock(floating, { type: "collapse", pane: "assistant" });
    expect(hidden).toMatchObject({ floating: true, floatingVisible: false, expanded: true });
    expect(resolveReplicaDockLayout(hidden, 520)).toMatchObject({ historyOpen: true, assistantOpen: false });
    const revealed = reduceReplicaDock(hidden, { type: "reveal", pane: "assistant" });
    expect(revealed.floatingVisible).toBe(true);
    const docked = reduceReplicaDock(revealed, { type: "dock" });
    expect(docked).toMatchObject({ floating: false, expanded: true, activePane: "assistant" });
  });

  it("持久化恢复拒绝错误模式、非法浮窗和非有限值，并约束比例", () => {
    expect(normalizeReplicaDockState(null)).toEqual(createReplicaDockState());
    expect(normalizeReplicaDockState({ mode: "unknown", expanded: true, activePane: "unknown", historyFraction: Infinity, chatWidth: -12, floatingRect: { x: 0, y: NaN, width: 600, height: 600 } })).toMatchObject({ mode: "exclusive", expanded: true, activePane: "history", historyFraction: .5, chatWidth: 240, floatingRect: null });
    const state = normalizeReplicaDockState({ mode: "side-by-side", activePane: "assistant", expanded: true, foldedPane: "history", historyFraction: 4, chatWidth: 300, floatingRect: { x: -10, y: -4, width: 100, height: 200 } });
    expect(state).toMatchObject({ mode: "side-by-side", activePane: "assistant", expanded: true, foldedPane: "history", historyFraction: .8, floatingRect: { x: 0, y: 0, width: 240, height: 280 } });
    expect(normalizeReplicaDockState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("移动端的独立抽屉不提供浮窗入口", () => {
    const html = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "历史", assistant: "聊天", initialHistoryOpen: true, storageKey: null }));
    expect(html).toContain('data-dock-mode="exclusive"');
    expect(html).toContain('role="tablist" aria-label="右侧面板"');
    expect(html).not.toContain("聊天在浮窗中打开");
  });

  it("单个启用模块的收起栏仅有相应入口，双关闭显示说明", () => {
    const history = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "历史内容", assistant: "聊天内容", assistantEnabled: false }));
    const historyRail = history.match(/<div class="replica-dock-rail is-single">([\s\S]*?)<\/div>/)?.[1];
    expect(historyRail).toContain('aria-label="展开历史记录"');
    expect(historyRail).not.toContain('aria-label="展开聊天"');
    expect(history).not.toContain("聊天在浮窗中打开");
    const assistant = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "历史内容", assistant: "聊天内容", historyEnabled: false }));
    const assistantRail = assistant.match(/<div class="replica-dock-rail is-single">([\s\S]*?)<\/div>/)?.[1];
    expect(assistantRail).toContain('aria-label="展开聊天"');
    expect(assistantRail).not.toContain('aria-label="展开历史记录"');
    const empty = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "历史内容", assistant: "聊天内容", historyEnabled: false, assistantEnabled: false, initialHistoryOpen: true, assistantOpenRequest: 1 }));
    expect(empty).toContain('class="replica-right-dock is-collapsed"');
    expect(empty).toContain('class="replica-dock-empty" role="status"');
    expect(empty).toContain("历史与聊天都已关闭，可在布局设置中启用。");
    expect(empty).not.toContain('class="replica-dock-rail');
    expect(empty).not.toContain('aria-label="展开聊天"');
    expect(empty).not.toContain('aria-label="展开历史记录"');
  });

  it("初始选择不可用时回到启用模块，工具栏不包含关闭模块或分栏菜单", () => {
    const history = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "历史内容", assistant: "聊天内容", assistantEnabled: false, assistantOpenRequest: 1 }));
    expect(history).toContain('class="replica-dock-pane replica-dock-history is-open"');
    expect(history).not.toContain('class="replica-dock-pane replica-dock-assistant is-open"');
    expect(history).not.toContain('role="tab" aria-selected="false"');
    expect(history).not.toContain("上下分栏");
    const assistant = renderToStaticMarkup(createElement(ReplicaRightDock, { history: "历史内容", assistant: "聊天内容", historyEnabled: false, initialHistoryOpen: true }));
    expect(assistant).toContain('class="replica-dock-pane replica-dock-assistant is-open"');
    expect(assistant).not.toContain('class="replica-dock-pane replica-dock-history is-open"');
    expect(assistant).not.toContain("左右分栏");
  });

  it("关闭模块时只投影当前显示，保留保存的模式、浮窗与比例以便重新启用", () => {
    const saved = { ...createReplicaDockState(true, true), mode: "side-by-side" as const, foldedPane: "history" as const, floating: true, historyFraction: .6, chatWidth: 300 };
    const historyOnly = resolveAvailableReplicaDockState(saved, { assistantEnabled: false });
    expect(historyOnly).toMatchObject({ mode: "exclusive", activePane: "history", floating: false, foldedPane: null, historyFraction: .6, chatWidth: 300 });
    expect(resolveReplicaDockLayout(saved, 600, { assistantEnabled: false })).toMatchObject({ historyOpen: true, assistantOpen: false, horizontal: false, restorePane: null });
    expect(saved).toMatchObject({ mode: "side-by-side", floating: true, foldedPane: "history" });
    expect(resolveAvailableReplicaDockState(saved)).toBe(saved);
    expect(resolveReplicaDockLayout(saved, 600)).toMatchObject({ historyOpen: true, assistantOpen: true });
  });

  it("单模块即使保存的是分栏也可一次收起，不能请求展开或浮出关闭模块", () => {
    const saved = createReplicaDockState(true, true);
    expect(reduceReplicaDock(saved, { type: "collapse", pane: "history" }, { assistantEnabled: false }).expanded).toBe(false);
    expect(reduceReplicaDock(saved, { type: "collapse", pane: "assistant" }, { historyEnabled: false }).expanded).toBe(false);
    expect(reduceReplicaDock(saved, { type: "reveal", pane: "assistant" }, { assistantEnabled: false })).toBe(saved);
    expect(reduceReplicaDock(saved, { type: "reveal", pane: "history" }, { historyEnabled: false })).toBe(saved);
    expect(reduceReplicaDock(saved, { type: "float" }, { assistantEnabled: false })).toBe(saved);
    expect(reduceReplicaDock(saved, { type: "dock" }, { assistantEnabled: false })).toBe(saved);
  });

  it("只启用助手且使用浮窗时不留下空白展开面板，关闭两个模块时浮窗也不可见", () => {
    const floating = reduceReplicaDock(createReplicaDockState(true, true), { type: "float" });
    expect(resolveAvailableReplicaDockState(floating, { historyEnabled: false }).expanded).toBe(false);
    expect(resolveReplicaDockLayout(floating, 600, { historyEnabled: false })).toMatchObject({ historyOpen: false, assistantOpen: true, horizontal: false });
    expect(resolveAvailableReplicaDockState(floating, { historyEnabled: false, assistantEnabled: false })).toMatchObject({ expanded: false, floating: false, floatingVisible: false });
    expect(resolveReplicaDockLayout(floating, 600, { historyEnabled: false, assistantEnabled: false })).toMatchObject({ historyOpen: false, assistantOpen: false, restorePane: null });
  });

  it("外部展开默认显示启用的历史；模块关闭时回到助手；双关闭不会展开", () => {
    const saved = { ...createReplicaDockState(), activePane: "assistant" as const };
    const history = reduceReplicaDock(saved, { type: "expansion", expanded: true });
    expect(history).toMatchObject({ expanded: true, activePane: "history", mode: "exclusive" });
    expect(resolveReplicaDockLayout(history, 280)).toMatchObject({ historyOpen: true, assistantOpen: false });
    const assistant = reduceReplicaDock(saved, { type: "expansion", expanded: true }, { historyEnabled: false });
    expect(assistant).toMatchObject({ expanded: true, activePane: "assistant" });
    expect(resolveReplicaDockLayout(assistant, 280, { historyEnabled: false })).toMatchObject({ historyOpen: false, assistantOpen: true });
    expect(reduceReplicaDock(saved, { type: "expansion", expanded: true }, { historyEnabled: false, assistantEnabled: false })).toBe(saved);
  });

  it("外部收起仅收起停靠栏，保留聊天浮窗、布局与分割状态", () => {
    const saved = { ...createReplicaDockState(true, true), mode: "side-by-side" as const, activePane: "assistant" as const, foldedPane: "history" as const, historyFraction: .6, chatWidth: 290, floating: true, floatingVisible: true, floatingRect: { x: 30, y: 40, width: 380, height: 560 } };
    const collapsed = reduceReplicaDock(saved, { type: "expansion", expanded: false });
    expect(collapsed).toEqual({ ...saved, expanded: false });
    expect(resolveReplicaDockLayout(collapsed, 520)).toMatchObject({ historyOpen: false, assistantOpen: true });
    const restored = reduceReplicaDock(collapsed, { type: "expansion", expanded: true });
    expect(restored).toMatchObject({ expanded: true, floating: true, floatingVisible: true, mode: "side-by-side", historyFraction: .6, chatWidth: 290, foldedPane: null });
    expect(restored.floatingRect).toBe(saved.floatingRect);
  });

  it("外部展开恢复历史折叠条，同时保留分栏模式及此前独占页", () => {
    const saved = { ...createReplicaDockState(), mode: "stacked" as const, activePane: "assistant" as const, foldedPane: "history" as const };
    const restored = reduceReplicaDock(saved, { type: "expansion", expanded: true });
    expect(restored).toMatchObject({ expanded: true, mode: "stacked", activePane: "assistant", foldedPane: null });
    expect(resolveReplicaDockLayout(restored, 280)).toMatchObject({ historyOpen: true, assistantOpen: true });
    const assistantFolded = reduceReplicaDock({ ...saved, foldedPane: "assistant" }, { type: "expansion", expanded: true });
    expect(assistantFolded.foldedPane).toBe("assistant");
    expect(resolveReplicaDockLayout(assistantFolded, 280)).toMatchObject({ historyOpen: true, assistantOpen: false, restorePane: "assistant" });
  });
});

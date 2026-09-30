import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplicaRightDock, resolveDockSplit } from "@/app/image/replica-right-dock";

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
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE_PREFERENCES } from "@/lib/appearance-store";
import { balancePreview } from "@/app/image/balance-preview";
import { NaiBalanceMeter } from "@/app/image/nai-balance-meter";

const appearance = vi.hoisted(() => ({ theme: "paper" }));
vi.mock("@/app/appearance", () => ({
  useAppearance: () => ({ preferences: { ...DEFAULT_APPEARANCE_PREFERENCES, theme: appearance.theme } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import ImageStudio from "@/app/image/studio";

function renderStudio(theme: string) {
  appearance.theme = theme;
  return renderToStaticMarkup(createElement(ImageStudio, { userName: "体验用户", authenticated: false }));
}

describe("工作台布局按主题隔离", () => {
  it.each(["paper", "dusk", "night"])("%s 保留顶部品牌、中央提示词和中央生成按钮", (theme) => {
    const html = renderStudio(theme);
    const left = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
    const canvas = html.slice(html.indexOf('<section class="studio-canvas'), html.indexOf('aria-label="调整右侧面板宽度"'));
    expect(html).toContain('data-studio-layout="classic"');
    expect(html).toContain("<header");
    expect(left).not.toContain("<textarea");
    expect(left).toContain('aria-label="采样步数"');
    expect(left).not.toContain('aria-label="打开站内菜单"');
    expect(canvas).toContain("<textarea");
    expect(canvas).toContain("执行生成");
    expect(html).toContain("创作中心");
    expect(html).not.toContain('class="nai-generation-footer"');
    expect(left.indexOf("导入图片")).toBeLessThan(left.indexOf('aria-label="模型"'));
    expect(left.indexOf('aria-label="采样步数"')).toBeLessThan(left.indexOf("生成张数"));
    expect(left.indexOf("生成张数")).toBeLessThan(left.indexOf("多角色"));
  });

  it("NAI 只在左侧渲染提示词、紧凑参数和生成区", () => {
    const html = renderStudio("nai");
    const left = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
    const canvas = html.slice(html.indexOf('<section class="studio-canvas'), html.indexOf('aria-label="调整右侧面板宽度"'));
    expect(html).toContain('data-studio-layout="nai"');
    expect(html).not.toContain("<header");
    expect(left).toContain("<textarea");
    expect(left).toContain('aria-label="生成参数"');
    expect(left).toContain('aria-label="图片宽度"');
    expect(left).toContain('aria-label="交换宽高"');
    expect(left).toContain('class="nai-generation-footer"');
    expect(left).toContain("生成 1 张图像");
    expect(left).toContain('aria-label="采样步数"');
    expect(left).toContain('class="nai-parameter-summary"');
    expect(canvas).not.toContain("<textarea");
    expect(canvas).not.toContain("执行生成");
    expect(html).not.toContain("创作中心");
    expect(html).toContain("--lfn-left:400px");
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

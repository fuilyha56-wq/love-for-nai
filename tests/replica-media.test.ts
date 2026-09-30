import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fitMediaSize, ReplicaMedia, resolveMediaColumns } from "@/app/image/replica-media";

describe("图片预览比例与批次布局", () => {
  it.each([[1024, 1024], [832, 1216], [1216, 832]])("%s × %s 适配空间而不裁切边缘", (width, height) => {
    const fitted = fitMediaSize(width, height, 600, 480);
    expect(fitted.width).toBeLessThanOrEqual(600);
    expect(fitted.height).toBeLessThanOrEqual(480);
    expect(fitted.width / fitted.height).toBeCloseTo(width / height, 10);
    expect(fitted.width === 600 || fitted.height === 480).toBe(true);
  });

  it("没有可用空间时不会产生无效尺寸", () => {
    expect(fitMediaSize(832, 1216, 0, 480)).toEqual({ width: 0, height: 0 });
    expect(fitMediaSize(0, 1216, 600, 480)).toEqual({ width: 0, height: 0 });
    expect(fitMediaSize(832, Infinity, 600, 480)).toEqual({ width: 0, height: 0 });
  });

  it("混合批次同列宽保留各张纵向、横向与方形的自然比例", () => {
    const shapes = [[832, 1216], [1216, 832], [1024, 1024]];
    const fitted = shapes.map(([width, height]) => fitMediaSize(width, height, 300, 1000));
    fitted.forEach((size, index) => {
      expect(size.width).toBe(300);
      expect(size.height).toBeCloseTo(300 * shapes[index][1] / shapes[index][0]);
    });
    expect(fitted[0].height).toBeGreaterThan(fitted[2].height);
    expect(fitted[1].height).toBeLessThan(fitted[2].height);
  });

  it("批次按数量选择2/3/4列，并为150px图卡保留8px边距及12px间距", () => {
    expect(resolveMediaColumns(4, 1000)).toBe(2);
    expect(resolveMediaColumns(6, 1000)).toBe(3);
    expect(resolveMediaColumns(8, 1000)).toBe(4);
    expect(resolveMediaColumns(8, 652)).toBe(4);
    expect(resolveMediaColumns(8, 651)).toBe(3);
    expect(resolveMediaColumns(4, 327)).toBe(1);
    expect(resolveMediaColumns(4, 328)).toBe(2);
    expect(resolveMediaColumns(8, 100)).toBe(1);
  });

  it("预览保留原始URL、逐图放大入口与六种操作", () => {
    const html = renderToStaticMarkup(createElement(ReplicaMedia, {
      variant: "nlw", images: ["/one.png", "/two.png"], width: 832, height: 1216, seed: "12345", onOpen: vi.fn(), onUse: vi.fn(),
    }));
    expect(html).toContain('src="/one.png"');
    expect(html).toContain('src="/two.png"');
    expect(html).not.toContain("/_next/image");
    expect(html).toContain('aria-label="放大查看第 2 张图像"');
    expect(html).toContain('download="lfn-2.png"');
    for (const label of ["用于图生图", "用于局部重绘", "用于导演工具", "用作 Vibe 参考", "用于放大"]) expect(html).toContain(`第 2 张${label}`);
    expect(html).toContain("832 × 1216");
    expect(html).toContain("12345");
  });

  it("NLW空态对应Aaalice预览提示并显示进行中的任务", () => {
    const html = renderToStaticMarkup(createElement(ReplicaMedia, {
      variant: "nlw", images: [], width: 832, height: 1216, seed: "", progress: "生成中 50%", onOpen: vi.fn(), onUse: vi.fn(),
    }));
    expect(html).toContain("输入提示词并点击生成");
    expect(html).toContain("图像将在这里显示");
    expect(html).toContain('role="status"');
    expect(html).toContain("生成中 50%");
    expect(html).not.toContain("replica-media-card");
  });
});

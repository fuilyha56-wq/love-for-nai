import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPLICA_SAMPLERS, ReplicaGenerationSettings, ReplicaImageSize, replicaSizePreset, type ReplicaGenerationSettingsProps } from "@/app/image/replica-generation-settings";

const noop = () => {};
const settings: Omit<ReplicaGenerationSettingsProps, "variant"> = {
  model: "nai-diffusion-5", steps: 23, scale: 7, seed: "", sampler: "k_euler_ancestral",
  schedule: "native", cfgRescale: 0, count: 1, batchMode: "sequential",
  setSteps: noop, setScale: noop, setSeed: noop, setSampler: noop, setSchedule: noop,
  setCfgRescale: noop, setCount: noop, setBatchMode: noop,
};

describe("独立复刻尺寸与参数组件", () => {
  it("匹配各方向预设，并为未匹配的实际尺寸保留自定义状态", () => {
    expect(replicaSizePreset(832, 1216)).toBe("normal-portrait");
    expect(replicaSizePreset(1216, 832)).toBe("normal-landscape");
    expect(replicaSizePreset(1024, 1024)).toBe("normal-square");
    expect(replicaSizePreset(896, 1152)).toBe("custom");
    expect(replicaSizePreset(1472, 1472, "nlw")).toBe("large-square");
    expect(replicaSizePreset(1472, 1472, "nai")).toBe("custom");
  });

  it("NAI 四个快捷数量之外仍可发现并编辑30张", () => {
    const html = renderToStaticMarkup(createElement(ReplicaImageSize, {
      variant: "nai", width: 832, height: 1216, count: 30,
      setWidth: noop, setHeight: noop, setCount: noop,
    }));
    expect(html).toContain('aria-label="生成张数"');
    expect(html).toContain('max="30"');
    expect(html).toContain('value="30"');
    expect(html).toContain('aria-label="竖图" title="竖图" aria-pressed="true"');
    expect(html).toContain('aria-label="交换宽高"');
    expect(html).toContain("自定义张数");
  });

  it("NLW 根据实际尺寸选择完整预设名称，不重复数量控件", () => {
    const html = renderToStaticMarkup(createElement(ReplicaImageSize, {
      variant: "nlw", width: 832, height: 1216, count: 1,
      setWidth: noop, setHeight: noop, setCount: noop,
    }));
    expect(html).toContain("常规 - 竖屏 (832×1216)");
    expect(html).toContain('aria-label="图片宽度"');
    expect(html).toContain('aria-label="图片高度"');
    expect(html).not.toContain('aria-label="生成张数"');
  });

  it("两个footer仅呈现各自摘要，展开控件初始不占滚动区", () => {
    const nai = renderToStaticMarkup(createElement(ReplicaGenerationSettings, { ...settings, variant: "nai" }));
    const nlw = renderToStaticMarkup(createElement(ReplicaGenerationSettings, { ...settings, variant: "nlw" }));
    expect(nai).toContain('data-replica-variant="nai"');
    expect(nai).toContain("欧拉祖先");
    expect(nai).toContain('aria-label="采样步数"');
    expect(nai).toContain('aria-expanded="false"');
    expect(nlw).toContain('data-replica-variant="nlw"');
    expect(nlw).toContain("NAI Diffusion V5 (Full)");
    expect(nlw).not.toContain('aria-label="采样步数"');
    expect(nai).not.toContain('aria-label="生成参数设置"');
    expect(nlw).not.toContain('aria-label="生成参数设置"');
  });

  it("按参考分组排序同时保留既有采样器API值", () => {
    expect(REPLICA_SAMPLERS.map((item) => item.value)).toEqual([
      "k_euler_ancestral", "k_euler", "k_dpmpp_2s_ancestral", "k_dpmpp_2m_sde", "k_dpmpp_2m", "k_dpmpp_sde", "ddim_v3",
    ]);
    expect(REPLICA_SAMPLERS[0].group).toBe("推荐");
  });
});

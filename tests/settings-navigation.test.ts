import { describe, expect, it } from "vitest";
import { settingsHashAlias, settingsSectionForHash } from "@/lib/settings-navigation";

describe("统一设置分类与旧入口", () => {
  it("提示词库与个人资料各自打开所属分类", () => {
    expect(settingsSectionForHash("#prompts")).toBe("prompts");
    expect(settingsSectionForHash("#profile")).toBe("profile");
  });
  it("旧模型接入深链接均打开模型与密钥", () => {
    for (const hash of ["#models", "#custom-providers", "#story-providers", "#api-tokens", "#novelai-account"]) {
      expect(settingsSectionForHash(hash)).toBe("models");
    }
  });
  it("旧故事入口归一到统一模型来源锚点", () => {
    expect(settingsHashAlias("#story-providers")).toBe("#custom-providers");
    expect(settingsHashAlias("#custom-providers")).toBe("#custom-providers");
  });
  it("本地 ONNX 标签模型锚点打开模型与密钥分类", () => {
    expect(settingsSectionForHash("#local-tagger")).toBe("models");
  });
  it("空地址和未知片段稳定恢复默认外观分类", () => {
    expect(settingsSectionForHash("")).toBe("appearance");
    expect(settingsSectionForHash("#appearance")).toBe("appearance");
    expect(settingsSectionForHash("#not-a-tab")).toBe("appearance");
  });
});

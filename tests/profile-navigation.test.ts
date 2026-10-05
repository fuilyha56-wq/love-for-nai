import { describe, expect, it } from "vitest";
import { PROFILE_SECTION_IDS, profileSectionForHash } from "@/lib/profile-navigation";

describe("个人资料分区导航", () => {
  it("按 hash 恢复分区并对未知入口回到奖励", () => {
    expect(profileSectionForHash("#profile-info")).toBe("profile-info");
    expect(profileSectionForHash("profile-security")).toBe("profile-security");
    expect(profileSectionForHash("#unknown")).toBe("profile-rewards");
    expect(profileSectionForHash("")).toBe("profile-rewards");
  });

  it("分区顺序稳定，奖励作为默认首屏", () => {
    expect(PROFILE_SECTION_IDS).toEqual(["profile-rewards", "profile-info", "profile-security"]);
  });
});

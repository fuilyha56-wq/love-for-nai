import { describe, expect, it } from "vitest";
import { groupIpEvidence } from "@/lib/ip-evidence-groups";

describe("IP evidence account groups", () => {
  it("shows one account row with separate IP evidence and per-user request totals", () => {
    const groups = groupIpEvidence([
      { evidenceId: "a", ipHmac: "ip-a", userId: 3, username: "示例用户", requestCount: 10, lastSeenAt: "2026-10-25T01:00:00Z" },
      { evidenceId: "b", ipHmac: "ip-b", userId: 3, username: "示例用户", requestCount: 20, lastSeenAt: "2026-10-25T02:00:00Z", users: { "3": { requestCount: 12 }, "4": { requestCount: 8 } } },
    ]);
    const user = groups.find(group => group.userId === 3)!;
    expect(user.items.map(item => item.evidenceId)).toEqual(["a", "b"]);
    expect(user.requestCount).toBe(22);
    expect(groups.find(group => group.userId === 4)?.requestCount).toBe(8);
    expect(groups.filter(group => group.userId === 3)).toHaveLength(1);
  });

  it("merges the same IP within an account without merging different addresses", () => {
    const [group] = groupIpEvidence([
      { evidenceId: "old", ipHmac: "same", userId: 3, requestCount: 2, lastSeenAt: "2026-10-24T01:00:00Z" },
      { evidenceId: "new", ipHmac: "same", userId: 3, requestCount: 5, lastSeenAt: "2026-10-25T01:00:00Z" },
    ]);
    expect(group.items).toHaveLength(1);
    expect(group.items[0]).toMatchObject({ evidenceId: "new", requestCount: 7 });
  });
});

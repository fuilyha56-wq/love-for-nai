import { describe, expect, it } from "vitest";
import { recentPromptVersions, recordPromptVersion } from "@/lib/prompt-versions";
import { galleryPosition } from "@/lib/gallery-navigation";

describe("prompt versions", () => {
  it("records every changed value newest first, including clearing and restoration", () => {
    let items = recordPromptVersion([], "prompt", "first", 1000, "1");
    items = recordPromptVersion(items, "negative", "bad quality", 1001, "2");
    items = recordPromptVersion(items, "prompt", "second", 1002, "3");
    items = recordPromptVersion(items, "prompt", "second", 1003, "duplicate");
    items = recordPromptVersion(items, "prompt", "", 1004, "4");
    items = recordPromptVersion(items, "prompt", "first", 1005, "5");
    expect(items.map(item => item.id)).toEqual(["5", "4", "3", "2", "1"]);
    expect(items.filter(item => item.target === "negative")).toHaveLength(1);
  });
  it("expires records after 60 seconds and rejects malformed or future records", () => {
    const items = recordPromptVersion([], "prompt", "private", 1000, "1");
    expect(recentPromptVersions(items, 60999)).toHaveLength(1);
    expect(recentPromptVersions(items, 61000)).toEqual([]);
    expect(recentPromptVersions([...items, { id: "future", target: "prompt", text: "x", createdAt: 70000 }, {}], 61000)).toEqual([]);
  });
});

describe("gallery return position", () => {
  it("keeps only safe gallery URLs and a bounded lifetime", () => {
    const saved = { href: "/gallery?page=2&q=sky", scrollY: 1250, savedAt: 1000 };
    expect(galleryPosition(saved, 2000)).toEqual(saved);
    for (const href of ["https://evil.invalid/gallery", "//evil.invalid", "/gallery/123", "/gallery-other", "javascript:alert(1)"])
      expect(galleryPosition({ ...saved, href }, 2000)).toBeNull();
    expect(galleryPosition({ ...saved, scrollY: -1 }, 2000)).toBeNull();
    expect(galleryPosition(saved, 1000 + 86400001)).toBeNull();
  });
});

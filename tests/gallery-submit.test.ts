import { describe, expect, it } from "vitest";
import {
  type GallerySubmitForm,
  validateGallerySubmitForm,
} from "@/app/gallery-submit";

function form(overrides: Partial<GallerySubmitForm> = {}): GallerySubmitForm {
  return {
    title: "作品",
    authorName: "作者",
    rating: "general",
    source: "local",
    tags: "",
    exposeParameters: true,
    ...overrides,
  };
}

describe("validateGallerySubmitForm", () => {
  it("requires historyId for LFN history submissions", () => {
    expect(validateGallerySubmitForm(form({ source: "lfn" }))).toContain(
      "historyId",
    );
    expect(
      validateGallerySubmitForm(form({ source: "lfn", historyId: "history-1" })),
    ).toBeNull();
  });

  it("requires a PNG or JPEG file for uploaded sources", () => {
    expect(validateGallerySubmitForm(form())).toBe("请选择要上传的图片");
    expect(
      validateGallerySubmitForm(
        form({ file: new File(["image"], "image.webp", { type: "image/webp" }) }),
      ),
    ).toBe("只支持 PNG 或 JPEG 图片");
    expect(
      validateGallerySubmitForm(
        form({
          source: "other",
          file: new File(["image"], "image.png", { type: "image/png" }),
        }),
      ),
    ).toBeNull();
  });

  it("rejects uploaded files larger than 20 MB", () => {
    const file = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.jpg", {
      type: "image/jpeg",
    });
    expect(validateGallerySubmitForm(form({ file }))).toBe("图片不能超过 20 MB");
  });
});

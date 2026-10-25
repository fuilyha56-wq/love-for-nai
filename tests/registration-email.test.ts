import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeSettings } from "@/lib/runtime-config";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));
let directory: string;
const settings = {
  smtpHost: "smtp.test",
  smtpPort: 587,
  smtpFrom: "lfn@example.com",
  smtpUser: "lfn",
  smtpPassword: "secret",
  smtpSecure: false,
} as RuntimeSettings;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-email-"));
  vi.stubEnv("LFN_DATA_DIR", directory);
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({ accepted: ["person@example.com"] });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
function sentCode() {
  return String(mocks.sendMail.mock.calls[0][0].text).match(/\d{6}/)![0];
}

describe("registration email verification", () => {
  it("stores only a salted hash, survives a module restart and accepts a code once", async () => {
    const { sendRegistrationEmail } = await import("@/lib/registration-email");
    await sendRegistrationEmail(settings, "person@example.com");
    const code = sentCode();
    const files = await readdir(path.join(directory, "registration-email"));
    const content = await readFile(
      path.join(directory, "registration-email", files[0]),
      "utf8",
    );
    expect(content).not.toContain(code);
    expect(content).not.toContain("person@example.com");
    vi.resetModules();
    const { consumeRegistrationEmail } =
      await import("@/lib/registration-email");
    expect(await consumeRegistrationEmail("PERSON@example.com", code)).toBe(
      true,
    );
    expect(await consumeRegistrationEmail("person@example.com", code)).toBe(
      false,
    );
    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ requireTLS: true }),
    );
  });
  it("binds codes to the email address and limits incorrect attempts", async () => {
    const { sendRegistrationEmail, consumeRegistrationEmail } =
      await import("@/lib/registration-email");
    await sendRegistrationEmail(settings, "person@example.com");
    expect(
      await consumeRegistrationEmail("other@example.com", sentCode()),
    ).toBe(false);
    for (let attempt = 0; attempt < 5; attempt++)
      expect(
        await consumeRegistrationEmail("person@example.com", "000000"),
      ).toBe(false);
    expect(
      await consumeRegistrationEmail("person@example.com", sentCode()),
    ).toBe(false);
  });
  it("rejects expired codes", async () => {
    const { sendRegistrationEmail, consumeRegistrationEmail } =
      await import("@/lib/registration-email");
    await sendRegistrationEmail(settings, "person@example.com");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 600_001);
    expect(
      await consumeRegistrationEmail("person@example.com", sentCode()),
    ).toBe(false);
  });
  it("does not publish a challenge when mail delivery fails", async () => {
    const { sendRegistrationEmail, consumeRegistrationEmail } =
      await import("@/lib/registration-email");
    mocks.sendMail.mockRejectedValue(new Error("SMTP unavailable"));
    await expect(
      sendRegistrationEmail(settings, "person@example.com"),
    ).rejects.toThrow();
    expect(await consumeRegistrationEmail("person@example.com", "123456")).toBe(
      false,
    );
  });
});

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// NewAPI's admin-create endpoint does not bind email addresses. Keep the
// registration identity in LFN for accounts created after our own verification.
type Identity = {
  username: string;
  email: string;
  verified: boolean;
  createdAt: string;
};
const shared = globalThis as typeof globalThis & {
  __lfnRegistrationIdentityLock?: Promise<unknown>;
};

export async function withRegistrationIdentity<T extends Response>(
  email: string,
  username: string,
  verified: boolean,
  create: () => Promise<T>,
): Promise<T | Response> {
  if (!email) return create();
  const task = async () => {
    const file = path.resolve(
      process.env.LFN_DATA_DIR || "data",
      "registration-identities.json",
    );
    let identities: Identity[];
    try {
      identities = JSON.parse(await readFile(file, "utf8")) as Identity[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      identities = [];
    }
    if (identities.some((item) => item.email === email))
      return Response.json({ message: "邮箱已被占用" }, { status: 400 });
    const response = await create();
    if (response.ok) {
      identities.push({
        username,
        email,
        verified,
        createdAt: new Date().toISOString(),
      });
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(temporary, JSON.stringify(identities), { mode: 0o600 });
      await rename(temporary, file);
    }
    return response;
  };
  const current = (
    shared.__lfnRegistrationIdentityLock || Promise.resolve()
  ).then(task, task);
  shared.__lfnRegistrationIdentityLock = current.catch(() => undefined);
  return current;
}

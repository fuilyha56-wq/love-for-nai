import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type LocalUser = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  passwordHash: string;
  role: number;
  status: number;
  group: string;
  createdAt: string;
};

type UserStore = { nextId: number; users: LocalUser[] };

const storeRoot = () =>
  path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "users");
const storePath = () => path.join(storeRoot(), "index.json");

function emptyStore(): UserStore {
  return { nextId: 1, users: [] };
}

async function readStore(): Promise<UserStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as Partial<UserStore>;
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    return {
      nextId:
        Number.isInteger(parsed.nextId) && Number(parsed.nextId) > 0
          ? Number(parsed.nextId)
          : users.reduce((max, user) => Math.max(max, user.id), 0) + 1,
      users,
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: UserStore): Promise<void> {
  await mkdir(storeRoot(), { recursive: true });
  const temp = `${storePath()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, storePath());
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function publicLocalUser(user: LocalUser) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    group: user.group,
    created_at: Date.parse(user.createdAt) || 0,
  };
}

export async function findLocalUserByUsername(username: string): Promise<LocalUser | null> {
  const store = await readStore();
  return (
    store.users.find(
      (user) => user.username.toLowerCase() === username.trim().toLowerCase(),
    ) || null
  );
}

export async function findLocalUserById(id: number): Promise<LocalUser | null> {
  const store = await readStore();
  return store.users.find((user) => user.id === id) || null;
}

export async function authenticateLocalUser(
  username: string,
  password: string,
): Promise<LocalUser | null> {
  const user = await findLocalUserByUsername(username);
  if (!user || user.status !== 1) return null;
  return verifyPassword(password, user.passwordHash) ? user : null;
}

export async function createLocalUser(input: {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
}): Promise<LocalUser> {
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9_\-.]{3,32}$/.test(username))
    throw new Error("用户名需为 3–32 位字母、数字或 _-.");
  if (input.password.length < 6) throw new Error("密码至少 6 位");
  const store = await readStore();
  if (store.users.some((user) => user.username.toLowerCase() === username.toLowerCase()))
    throw new Error("用户名已被占用");
  const bootstrapAdmin =
    process.env.LFN_LOCAL_ADMIN_USERNAME?.trim().toLowerCase() === username.toLowerCase() ||
    store.users.length === 0;
  const user: LocalUser = {
    id: store.nextId,
    username,
    displayName: input.displayName?.trim() || username,
    email: input.email?.trim() || "",
    passwordHash: hashPassword(input.password),
    role: bootstrapAdmin ? 10 : 1,
    status: 1,
    group: process.env.LFN_REGISTER_GROUP?.trim() || "default",
    createdAt: new Date().toISOString(),
  };
  store.nextId += 1;
  store.users.push(user);
  await writeStore(store);
  return user;
}

export async function updateLocalUser(
  id: number,
  patch: {
    displayName?: string;
    username?: string;
    password?: string;
    role?: number;
    group?: string;
    status?: number;
  },
): Promise<LocalUser> {
  const store = await readStore();
  const user = store.users.find((item) => item.id === id);
  if (!user) throw new Error("用户不存在");
  if (patch.displayName) user.displayName = patch.displayName.trim();
  if (patch.username) {
    if (!/^[a-zA-Z0-9_\-.]{3,32}$/.test(patch.username))
      throw new Error("用户名需为 3–32 位字母、数字或 _-.");
    if (
      store.users.some(
        (item) =>
          item.id !== id && item.username.toLowerCase() === patch.username!.toLowerCase(),
      )
    )
      throw new Error("用户名已被占用");
    user.username = patch.username.trim();
  }
  if (patch.password) {
    if (patch.password.length < 6) throw new Error("密码至少 6 位");
    user.passwordHash = hashPassword(patch.password);
  }
  if (patch.role === 1 || patch.role === 10 || patch.role === 100) {
    if (user.role >= 10 && patch.role < 10 && !hasOtherActiveAdmin(store.users, id))
      throw new Error("不能取消最后一位管理员");
    user.role = patch.role;
  }
  if (typeof patch.group === "string" && patch.group.trim()) user.group = patch.group.trim();
  if (patch.status === 0 || patch.status === 1) {
    if (user.role >= 10 && patch.status === 0 && !hasOtherActiveAdmin(store.users, id))
      throw new Error("不能停用最后一位管理员");
    user.status = patch.status;
  }
  await writeStore(store);
  return user;
}

function hasOtherActiveAdmin(users: LocalUser[], exceptId: number): boolean {
  return users.some((item) => item.id !== exceptId && item.role >= 10 && item.status === 1);
}

export async function listLocalUsers(options: {
  page: number;
  size: number;
  keyword?: string;
}): Promise<{ items: ReturnType<typeof publicLocalUser>[]; total: number }> {
  const store = await readStore();
  const keyword = options.keyword?.trim().toLowerCase() || "";
  const filtered = keyword
    ? store.users.filter((user) =>
        `${user.username} ${user.displayName} ${user.email}`.toLowerCase().includes(keyword),
      )
    : store.users;
  const page = Math.max(1, options.page);
  const size = Math.min(100, Math.max(1, options.size));
  const start = (page - 1) * size;
  return {
    items: filtered.slice(start, start + size).map(publicLocalUser),
    total: filtered.length,
  };
}

export async function countLocalUsers(): Promise<number> {
  return (await readStore()).users.length;
}

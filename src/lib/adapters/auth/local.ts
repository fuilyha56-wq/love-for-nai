/**
 * 本地认证适配器
 * 使用 LFN 内部 PostgreSQL 存储用户信息
 */

import type { AuthAdapter, AuthUserInfo, EndpointConfig } from "../types";
import { db } from "@/lib/db";
import { createHash, randomBytes, timingSafeEqual } from "crypto";

// 使用 Node.js 内置 crypto 实现密码哈希（PBKDF2）
const SALT_LENGTH = 16;
const HASH_ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

function hashPassword(password: string, salt: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    require("crypto").pbkdf2(
      password,
      salt,
      HASH_ITERATIONS,
      KEY_LENGTH,
      DIGEST,
      (err: Error | null, derivedKey: Buffer) => {
        if (err) reject(err);
        else resolve(derivedKey.toString("hex"));
      }
    );
  });
}

async function hash(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hashedPassword = await hashPassword(password, salt);
  return `${salt.toString("hex")}:${hashedPassword}`;
}

async function compare(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, hash] = storedHash.split(":");
  if (!saltHex || !hash) return false;
  const salt = Buffer.from(saltHex, "hex");
  const hashedPassword = await hashPassword(password, salt);
  return hashedPassword === hash;
}

export function createLocalAuthAdapter(config: EndpointConfig): AuthAdapter {
  return {
    type: "local",
    name: config.name,

    async login(username: string, password: string) {
      const user = await db.oneOrNone(
        "SELECT id, username, email, display_name, role, status, password_hash FROM lfn_users WHERE username = $1",
        [username]
      );
      if (!user || !(await compare(password, user.password_hash))) {
        throw new Error("用户名或密码错误");
      }
      if (user.status === 0) {
        throw new Error("账号已停用");
      }
      const token = `lfn_${Buffer.from(`${user.id}:${Date.now()}:${Math.random()}`).toString("base64")}`;
      await db.none(
        "INSERT INTO lfn_sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
        [user.id, token]
      );
      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          status: user.status,
        },
      };
    },

    async register(username: string, password: string, metadata?: Record<string, unknown>) {
      const exists = await db.oneOrNone("SELECT 1 FROM lfn_users WHERE username = $1", [username]);
      if (exists) throw new Error("用户名已存在");

      const passwordHash = await hash(password);
      const user = await db.one(
        `INSERT INTO lfn_users (username, password_hash, email, display_name, role, status)
         VALUES ($1, $2, $3, $4, 1, 1)
         RETURNING id, username, email, display_name, role, status`,
        [username, passwordHash, metadata?.email || null, metadata?.displayName || null]
      );

      const token = `lfn_${Buffer.from(`${user.id}:${Date.now()}:${Math.random()}`).toString("base64")}`;
      await db.none(
        "INSERT INTO lfn_sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
        [user.id, token]
      );

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          status: user.status,
        },
      };
    },

    async verifyToken(token: string) {
      const session = await db.oneOrNone(
        `SELECT u.id, u.username, u.email, u.display_name, u.role, u.status
         FROM lfn_sessions s
         JOIN lfn_users u ON u.id = s.user_id
         WHERE s.token = $1 AND s.expires_at > NOW()`,
        [token.replace(/^Bearer\s+/i, "")]
      );
      if (!session) return null;
      return {
        id: session.id,
        username: session.username,
        email: session.email,
        displayName: session.display_name,
        role: session.role,
        status: session.status,
      };
    },

    async logout(token: string) {
      await db.none("DELETE FROM lfn_sessions WHERE token = $1", [token.replace(/^Bearer\s+/i, "")]);
    },

    async getUser(id: number | string) {
      const user = await db.oneOrNone(
        "SELECT id, username, email, display_name, role, status FROM lfn_users WHERE id = $1",
        [typeof id === "number" ? id : Number(id)]
      );
      if (!user) return null;
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
      };
    },

    async listUsers(filters) {
      let query = "SELECT id, username, email, display_name, role, status FROM lfn_users WHERE 1=1";
      const params: any[] = [];
      if (filters?.role !== undefined) {
        params.push(filters.role);
        query += ` AND role = $${params.length}`;
      }
      if (filters?.status !== undefined) {
        params.push(filters.status);
        query += ` AND status = $${params.length}`;
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        query += ` AND (username ILIKE $${params.length} OR email ILIKE $${params.length})`;
      }
      query += " ORDER BY id DESC LIMIT 100";

      const users = await db.any(query, params);
      return users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
      }));
    },

    async updateUser(id: number | string, updates: Partial<AuthUserInfo>) {
      const sets: string[] = [];
      const params: any[] = [];
      if (updates.email !== undefined) {
        params.push(updates.email);
        sets.push(`email = $${params.length}`);
      }
      if (updates.displayName !== undefined) {
        params.push(updates.displayName);
        sets.push(`display_name = $${params.length}`);
      }
      if (updates.role !== undefined) {
        params.push(updates.role);
        sets.push(`role = $${params.length}`);
      }
      if (updates.status !== undefined) {
        params.push(updates.status);
        sets.push(`status = $${params.length}`);
      }
      if (!sets.length) return;

      params.push(typeof id === "number" ? id : Number(id));
      await db.none(`UPDATE lfn_users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    },
  };
}

/**
 * NewAPI 认证适配器
 * 包装现有 NewAPI 认证逻辑
 */

import type { AuthAdapter, AuthUserInfo, EndpointConfig } from "../types";

export function createNewApiAuthAdapter(config: EndpointConfig): AuthAdapter {
  const baseUrl = config.config.baseUrl?.replace(/\/+$/, "") || "";
  const adminToken = config.config.token || "";

  async function fetchNewApi(path: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (adminToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${adminToken}`);
    }
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  }

  return {
    type: "newapi",
    name: config.name,

    async login(username: string, password: string) {
      const response = await fetchNewApi("/api/user/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "登录失败");
      }
      const result = await response.json();
      return {
        token: result.data?.token || result.token,
        user: {
          id: result.data?.id || result.id,
          username: result.data?.username || username,
          email: result.data?.email,
          displayName: result.data?.display_name,
          role: result.data?.role,
          status: result.data?.status,
          quota: result.data?.quota,
          group: result.data?.group,
        },
      };
    },

    async register(username: string, password: string, metadata?: Record<string, unknown>) {
      const response = await fetchNewApi("/api/user/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          email: metadata?.email,
          verification_code: metadata?.verification_code || "",
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "注册失败");
      }
      const result = await response.json();
      return {
        token: result.data?.token || result.token,
        user: {
          id: result.data?.id || result.id,
          username,
          email: metadata?.email as string | undefined,
          role: 1,
          status: 1,
        },
      };
    },

    async verifyToken(token: string) {
      const response = await fetch(`${baseUrl}/api/user/self`, {
        headers: { Authorization: token },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const result = await response.json();
      if (!result.success || !result.data) return null;
      return {
        id: result.data.id,
        username: result.data.username,
        email: result.data.email,
        displayName: result.data.display_name,
        role: result.data.role,
        status: result.data.status,
        quota: result.data.quota,
        group: result.data.group,
      };
    },

    async logout(token: string) {
      await fetch(`${baseUrl}/api/user/logout`, {
        method: "POST",
        headers: { Authorization: token },
      });
    },

    async getUser(id: number | string) {
      const response = await fetchNewApi(`/api/user/${id}`);
      if (!response.ok) return null;
      const result = await response.json();
      if (!result.success || !result.data) return null;
      return {
        id: result.data.id,
        username: result.data.username,
        email: result.data.email,
        displayName: result.data.display_name,
        role: result.data.role,
        status: result.data.status,
        quota: result.data.quota,
        group: result.data.group,
      };
    },

    async listUsers(filters) {
      const params = new URLSearchParams();
      if (filters?.search) params.set("keyword", filters.search);
      const response = await fetchNewApi(`/api/user/?${params}`);
      if (!response.ok) return [];
      const result = await response.json();
      if (!result.success || !Array.isArray(result.data)) return [];
      return result.data.map((user: any) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
        quota: user.quota,
        group: user.group,
      }));
    },

    async updateUser(id: number | string, updates: Partial<AuthUserInfo>) {
      const payload: Record<string, unknown> = {
        id: typeof id === "number" ? id : Number(id),
        username: updates.username,
      };
      if (updates.email !== undefined) payload.email = updates.email;
      if (updates.displayName !== undefined) payload.display_name = updates.displayName;
      if (updates.role !== undefined) payload.role = updates.role;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.group !== undefined) payload.group = updates.group;

      const response = await fetchNewApi("/api/user/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "更新用户失败");
      }
    },

    async listKeys(userId: number | string) {
      const response = await fetchNewApi(`/api/user/token?user_id=${userId}`);
      if (!response.ok) return [];
      const result = await response.json();
      if (!result.success || !Array.isArray(result.data)) return [];
      return result.data.map((token: any) => ({
        key: token.key,
        name: token.name,
        createdAt: token.created_time ? new Date(token.created_time * 1000).toISOString() : undefined,
      }));
    },

    async createKey(userId: number | string, name?: string) {
      const response = await fetchNewApi("/api/user/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: typeof userId === "number" ? userId : Number(userId),
          name: name || "LFN API Key",
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "创建密钥失败");
      }
      const result = await response.json();
      return result.data?.key || result.key;
    },

    async deleteKey(key: string) {
      const response = await fetchNewApi(`/api/user/token/${key}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("删除密钥失败");
      }
    },

    async resolveKeyToUser(key: string) {
      return this.verifyToken(`Bearer ${key}`);
    },
  };
}

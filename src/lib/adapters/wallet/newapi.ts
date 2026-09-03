/**
 * NewAPI 钱包适配器
 * 管理 NewAPI quota 和 LFN 内部 AFF 余额
 */

import type { WalletAdapter, WalletBalance, WalletTransaction, EndpointConfig } from "../types";
import { db } from "@/lib/db";

export function createNewApiWalletAdapter(config: EndpointConfig): WalletAdapter {
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

    async getBalance(userId: number | string) {
      const numericUserId = typeof userId === "number" ? userId : Number(userId);
      
      // 获取 NewAPI quota
      let upstreamBalance: number | undefined;
      try {
        const response = await fetchNewApi(`/api/user/${numericUserId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            upstreamBalance = result.data.quota ?? undefined;
          }
        }
      } catch {
        upstreamBalance = undefined;
      }

      // 获取 LFN AFF 余额
      const aff = await db.oneOrNone(
        "SELECT balance, package_balance FROM aff_accounts WHERE user_id = $1",
        [numericUserId]
      );

      return {
        userId: numericUserId,
        upstreamBalance,
        credits: aff?.balance ?? 0,
        packages: aff?.package_balance ?? 0,
      };
    },

    async charge(userId: number | string, amount: number, description: string, metadata?: Record<string, unknown>) {
      const numericUserId = typeof userId === "number" ? userId : Number(userId);
      const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      await db.none(
        `INSERT INTO aff_transactions (id, user_id, amount, type, source, description, metadata, created_at)
         VALUES ($1, $2, $3, 'debit', $4, $5, $6, NOW())`,
        [txId, numericUserId, -amount, metadata?.source || "image_generation", description, JSON.stringify(metadata || {})]
      );

      await db.none(
        `UPDATE aff_accounts SET balance = balance - $1 WHERE user_id = $2`,
        [amount, numericUserId]
      );

      return {
        id: txId,
        userId: numericUserId,
        amount: -amount,
        type: "debit" as const,
        source: (metadata?.source as any) || "image_generation",
        description,
        createdAt: new Date().toISOString(),
        metadata,
      };
    },

    async refund(transactionId: string, amount: number) {
      const original = await db.oneOrNone(
        "SELECT user_id, amount, description FROM aff_transactions WHERE id = $1",
        [transactionId]
      );
      if (!original) throw new Error("原始交易不存在");

      const refundId = `rf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await db.none(
        `INSERT INTO aff_transactions (id, user_id, amount, type, source, description, created_at)
         VALUES ($1, $2, $3, 'refund', 'refund', $4, NOW())`,
        [refundId, original.user_id, amount, `退款：${original.description}`]
      );

      await db.none(
        `UPDATE aff_accounts SET balance = balance + $1 WHERE user_id = $2`,
        [amount, original.user_id]
      );

      return {
        id: refundId,
        userId: original.user_id,
        amount,
        type: "refund" as const,
        source: "refund" as const,
        description: `退款：${original.description}`,
        createdAt: new Date().toISOString(),
      };
    },

    async adjustBalance(userId: number | string, amount: number, description: string) {
      const numericUserId = typeof userId === "number" ? userId : Number(userId);
      const txId = `adj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const type = amount > 0 ? "credit" : "debit";

      await db.none(
        `INSERT INTO aff_transactions (id, user_id, amount, type, source, description, created_at)
         VALUES ($1, $2, $3, $4, 'admin', $5, NOW())`,
        [txId, numericUserId, amount, type, description]
      );

      await db.none(
        `INSERT INTO aff_accounts (user_id, balance) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET balance = aff_accounts.balance + $2`,
        [numericUserId, amount]
      );
    },

    async listTransactions(userId: number | string, options?: { limit?: number; offset?: number }) {
      const numericUserId = typeof userId === "number" ? userId : Number(userId);
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;

      const transactions = await db.any(
        `SELECT id, user_id, amount, type, source, description, metadata, created_at
         FROM aff_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [numericUserId, limit, offset]
      );

      return transactions.map((tx) => ({
        id: tx.id,
        userId: tx.user_id,
        amount: tx.amount,
        type: tx.type,
        source: tx.source,
        description: tx.description,
        createdAt: tx.created_at.toISOString(),
        metadata: tx.metadata,
      }));
    },

    async logUsage(userId: number | string, model: string, usage: Record<string, unknown>) {
      const numericUserId = typeof userId === "number" ? userId : Number(userId);
      await db.none(
        `INSERT INTO aff_usage_logs (user_id, model, usage, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [numericUserId, model, JSON.stringify(usage)]
      );
    },
  };
}

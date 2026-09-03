/**
 * LFN 数据库连接池
 * 用于适配器系统访问 LFN 内部表（lfn_endpoints, lfn_users 等）
 */

import { Pool, QueryResultRow } from "pg";

const globalStore = globalThis as typeof globalThis & {
  __lfnDbPool?: Pool;
};

function getPool(): Pool {
  if (!globalStore.__lfnDbPool) {
    const connectionString = process.env.DATABASE_URL?.trim() || process.env.NEWAPI_DB_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL or NEWAPI_DB_URL is not configured");
    }
    globalStore.__lfnDbPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
    });
  }
  return globalStore.__lfnDbPool;
}

export const db = {
  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
    return getPool().query<T>(text, params);
  },

  async one<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T> {
    const result = await getPool().query<T>(text, params);
    if (result.rows.length === 0) {
      throw new Error("No rows returned");
    }
    return result.rows[0];
  },

  async oneOrNone<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T | null> {
    const result = await getPool().query<T>(text, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  },

  async any<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T[]> {
    const result = await getPool().query<T>(text, params);
    return result.rows;
  },

  async none(text: string, params?: any[]): Promise<void> {
    await getPool().query(text, params);
  },
};

import { runtimeRemoteHistory } from "@/lib/runtime-config";

// 二级历史存储客户端：把本地保留不下的历史图转存到远程 LFN 存储服务。
// 远程服务是一个极简 HTTP 服务（PUT/GET/DELETE + Bearer 鉴权），
// 部署在独立的存储节点上（当前为华为云 ECS）。

export type RemoteStoreConfig = {
  baseUrl: string;
  token: string;
};

export function remoteHistoryStore(): RemoteStoreConfig | null {
  const baseUrl = process.env.LFN_REMOTE_HISTORY_URL?.trim().replace(/\/+$/, "");
  const token = process.env.LFN_REMOTE_HISTORY_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

async function resolvedRemoteHistoryStore(): Promise<RemoteStoreConfig | null> {
  try {
    return await runtimeRemoteHistory();
  } catch {
    return remoteHistoryStore();
  }
}

function authHeaders(config: RemoteStoreConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/octet-stream",
  };
}

function objectPath(userId: number, fileName: string): string {
  // 文件名已在调用侧规范化为 uuid.ext，这里再防御一次目录穿越。
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "");
  return `${userId}/${safe}`;
}

/** 上传一张历史图到远程存储；失败返回 false，调用方保留本地处理路径。 */
export async function putRemoteHistoryImage(
  userId: number,
  fileName: string,
  data: Buffer,
): Promise<boolean> {
  const config = await resolvedRemoteHistoryStore();
  if (!config) return false;
  try {
    const response = await fetch(
      `${config.baseUrl}/objects/${objectPath(userId, fileName)}`,
      {
        method: "PUT",
        headers: authHeaders(config),
        body: new Uint8Array(data),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** 从远程存储读取一张历史图；不存在或失败返回 null。 */
export async function getRemoteHistoryImage(
  userId: number,
  fileName: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const config = await resolvedRemoteHistoryStore();
  if (!config) return null;
  try {
    const response = await fetch(
      `${config.baseUrl}/objects/${objectPath(userId, fileName)}`,
      {
        headers: { Authorization: `Bearer ${config.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      data: buffer,
      contentType:
        response.headers.get("content-type") || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

/** 删除远程存储上的一张历史图；失败静默（过期清理是尽力而为）。 */
export async function deleteRemoteHistoryImage(
  userId: number,
  fileName: string,
): Promise<boolean> {
  const config = await resolvedRemoteHistoryStore();
  if (!config) return false;
  try {
    const response = await fetch(
      `${config.baseUrl}/objects/${objectPath(userId, fileName)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

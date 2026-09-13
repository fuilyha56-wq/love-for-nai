/**
 * NAI 网关请求日志。
 *
 * LFN 对 Gateway / NewAPI 上游的每一次生成类请求都会输出一行结构化
 * JSON 日志，记录发起用户、请求来源（lfn 站内工作台 / api 外部兼容
 * 端点）、端点与上游状态码，便于在 docker logs 中直接审计用量归属。
 *
 * 示例输出：
 * [NAI-GATEWAY] {"ts":"2026-09-13T08:00:00.000Z","source":"lfn","user":"ly","endpoint":"/ai/generate-image-stream","op":"generate","model":"nai-v5-full","samples":1,"status":200,"ms":8213}
 */

export type GatewayLogSource = "lfn" | "api";

export type GatewayLogMeta = {
  source: GatewayLogSource;
  user: string;
  endpoint: string;
  op?: string;
  model?: string;
  samples?: number;
};

export function gatewayLogStart(meta: GatewayLogMeta) {
  const startedAt = Date.now();
  return (status: number) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...meta,
      status,
      ms: Date.now() - startedAt,
    });
    console.log(`[NAI-GATEWAY] ${line}`);
  };
}

/** 外部 API Key 只记末 4 位，避免完整密钥进日志。 */
export function maskKeyForLog(authorization: string): string {
  const key = authorization.replace(/^Bearer\s+/i, "").trim();
  return key.length > 8 ? `***${key.slice(-4)}` : "***";
}

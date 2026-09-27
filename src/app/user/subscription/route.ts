import { bearerAuthorization, naiSubscriptionResponse } from "@/lib/compat-api";
import { resolveExternalApiIdentity } from "@/lib/newapi-db";

/**
 * NovelAI 原生 /user/subscription 兼容端点。
 *
 * 第三方客户端（Aaalice NAI Launcher 等）第三方登录流程：
 * 1. GET /user/subscription —— 404 才降级用生成端点探测；403 等其他
 *    4xx 会被客户端归为未知错误，导致登录失败。所以必须返回 200。
 * 2. 生成走 /ai/generate-image 等原生端点（Bearer NewAPI key）。
 *
 * 站点策略：账户明细不对普通用户开放（/user/* 其余路径仍 403），
 * 但订阅摘要用站内 AFF 账本合成返回，保证第三方客户端可登录并显示余额。
 */
export async function GET(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  const identity = await resolveExternalApiIdentity(authorization);
  if (identity.userId == null)
    return Response.json(
      {
        message: "无效的 API Key",
        error: {
          message: "无效的 API Key",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      { status: 401 },
    );
  return naiSubscriptionResponse(identity.userId);
}

export async function POST(request: Request): Promise<Response> {
  return GET(request);
}

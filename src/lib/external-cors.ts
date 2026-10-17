/** CORS policy for browser-based third-party API clients. */
export const EXTERNAL_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Origin, X-Requested-With, X-API-Key, X-NovelAI-Operation, X-NovelAI-Extra-Params",
  "Access-Control-Expose-Headers": "Content-Type, X-Anlas-Cost, X-Prompt-Tokens, X-LFN-Payment-Source, X-LFN-Request-ID, X-LFN-Request-Fingerprint, X-LFN-Watermark",
} as const;

export function withExternalCors(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(EXTERNAL_CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function externalCorsPreflight(): Response {
  return new Response(null, { status: 204, headers: EXTERNAL_CORS_HEADERS });
}

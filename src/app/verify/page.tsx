"use client";

import { useEffect, useState } from "react";
import { Upload, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

type VerifyResult = {
  valid: boolean;
  legacy?: boolean;
  recordFound?: boolean;
  payload?: {
    schema?: string;
    keyId?: string;
    imageId?: string;
    requestId: string;
    requestFingerprint?: string;
    sha256: string;
    timestamp: string;
    userId: number;
    model: string;
    domain: string;
    issuer?: string;
    label?: string;
    note?: string;
    parameters?: Record<string, unknown>;
  };
  shaMatch?: boolean;
  audit?: { requestFingerprint?: string; endpoint?: string; operation?: string; parameters?: Record<string, unknown>; paymentSource?: string; status?: number; durationMs?: number } | null;
  history?: { parameters?: Record<string, unknown>; usage?: unknown; watermarkStatus?: string } | null;
  error?: string;
};

export default function ImageVerifyPage() {
  const [image, setImage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  useEffect(() => {
    const listener = (event: ClipboardEvent) => {
      const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) void handleFile(file);
    };
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  });

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setImage(dataUrl);
      setResult(null);
      
      setVerifying(true);
      try {
        const response = await fetch("/api/images/verify-watermark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });
        const data = await response.json() as VerifyResult;
        setResult(data);
      } catch (error) {
        setResult({ valid: false, error: error instanceof Error ? error.message : "验证失败" });
      } finally {
        setVerifying(false);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) void handleFile(file);
        break;
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="font-[var(--font-display)] text-3xl text-[var(--rose)]">图片溯源检测</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">验证图片是否来自 Love-for-NAI</p>
      </div>

      <div
        className="rounded-lg border-2 border-dashed border-[var(--line)] bg-[#f7f5ef] p-8 text-center"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onPaste={handlePaste}
        tabIndex={0}
      >
        <Upload size={48} className="mx-auto text-[var(--muted)]" />
        <p className="mt-4 text-sm font-medium">拖拽图片到此处或 Ctrl+V 粘贴</p>
        <p className="mt-1 text-xs text-[var(--muted)]">支持 PNG 格式水印验证</p>
        <label className="mt-4 inline-block cursor-pointer rounded-md bg-[var(--rose)] px-4 py-2 text-sm font-medium text-white hover:bg-[#8b4545]">
          选择文件
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
      </div>

      {image && (
        <div className="mt-6">
          <img src={image} alt="上传的图片" className="mx-auto max-h-96 rounded-lg border border-[var(--line)]" />
        </div>
      )}

      {verifying && (
        <div className="mt-6 rounded-lg border border-[var(--line)] bg-white p-6 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[var(--line)] border-t-[var(--rose)]" />
          <p className="mt-4 text-sm text-[var(--muted)]">正在验证水印…</p>
        </div>
      )}

      {result && !verifying && (
        <div className="mt-6 rounded-lg border border-[var(--line)] bg-white p-6">
          <div className="flex items-center gap-3">
            {result.valid && result.shaMatch ? (
              <CheckCircle2 size={24} className="text-[var(--mint)]" />
            ) : result.valid && !result.shaMatch ? (
              <AlertCircle size={24} className="text-yellow-600" />
            ) : (
              <XCircle size={24} className="text-[var(--rose)]" />
            )}
            <div>
              <p className="font-medium">
                {result.valid && result.shaMatch
                  ? "✓ 验证通过：图片来自 Love-for-NAI"
                  : result.valid && !result.shaMatch
                    ? "⚠ 签名有效但图片已被修改"
                    : "✗ 验证失败"}
              </p>
              {result.error && <p className="mt-1 text-xs text-[var(--muted)]">{result.error}</p>}
            </div>
          </div>

          {result.payload && (
            <>
            <dl className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">请求 ID</dt>
                <dd className="font-mono text-xs">{result.payload.requestId}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted)]">签名记录</dt>
                <dd>{result.recordFound ? "已找到服务端记录" : "仅本地签名，未找到服务端记录"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted)]">发行方</dt>
                <dd>{result.payload.issuer || result.payload.domain}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">用户 ID</dt>
                <dd>{result.payload.userId}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">模型</dt>
                <dd>{result.payload.model}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">生成时间</dt>
                <dd>{new Date(result.payload.timestamp).toLocaleString("zh-CN")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">来源</dt>
                <dd>{result.payload.domain}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">图片哈希</dt>
                <dd className="font-mono text-xs">{result.payload.sha256.slice(0, 16)}...</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">完整性</dt>
                <dd className={result.shaMatch ? "text-[var(--mint)]" : "text-yellow-600"}>
                  {result.shaMatch ? "未修改" : "已修改"}
                </dd>
              </div>
            </dl>
            {result.audit?.parameters && <div className="mt-4 border-t border-[var(--line)] pt-4">
              <p className="mb-2 text-xs font-semibold text-[var(--rose)]">完整生成参数</p>
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                {Object.entries(result.audit.parameters).map(([key, value]) => <div key={key} className="min-w-0"><dt className="inline text-[var(--muted)]">{key}：</dt><dd className="inline break-words">{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}
              </dl>
            </div>}
            {result.history?.usage && <p className="mt-3 text-xs text-[var(--muted)]">用量：{JSON.stringify(result.history.usage)}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

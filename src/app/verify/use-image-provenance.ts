"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

type VerifyResult = {
  valid: boolean;
  legacy?: boolean;
  shaMatch?: boolean;
  recordFound?: boolean;
  payload?: {
    requestId: string;
    sha256: string;
    timestamp: string;
    model: string;
    domain: string;
    issuer: string;
    source?: "gateway";
    metadataStripped?: true;
  };
  error?: string;
};

export function useImageProvenance() {
  const [image, setImage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);

  const verifyImage = useCallback(async (file: File) => {
    pending.current?.abort();
    if (!IMAGE_MIME_TYPES.includes(file.type) || !file.size || file.size > 25 * 1024 * 1024) {
      setImage(null);
      setVerifying(false);
      setResult({ valid: false, error: "请选择不超过 25 MiB 的 PNG、JPEG 或 WebP 图片" });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setImage(URL.createObjectURL(file));
    setResult(null);
    setVerifying(true);

    try {
      const response = await fetch("/api/images/verify-watermark", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
        signal: controller.signal,
      });
      const data = await response.json() as VerifyResult;
      if (!response.ok) throw new Error(data.error || "验证失败，请重试");
      if (!controller.signal.aborted) setResult(data);
    } catch (error) {
      if (!controller.signal.aborted) setResult({ valid: false, error: error instanceof Error ? error.message : "验证失败" });
    } finally {
      if (!controller.signal.aborted) setVerifying(false);
      if (pending.current === controller) pending.current = null;
    }
  }, []);

  return { image, verifying, result, verifyImage };
}

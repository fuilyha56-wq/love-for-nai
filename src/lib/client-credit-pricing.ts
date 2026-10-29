"use client";
import { useCallback, useEffect, useState } from "react";
import { CNY_PER_AFF } from "@/lib/image-pricing";
import { type CreditPricing } from "@/lib/credit-pricing";
export function useCreditPricing() {
  const [data, setData] = useState<CreditPricing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/public/credit-pricing", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.policy || !result.fixedCosts || result.cnyPerAff !== CNY_PER_AFF)
        throw new Error(result.message || "暂时无法读取本站计价");
      setData(result); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "价格读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { data, error, loading, refresh };
}


export type CreditPricingState = ReturnType<typeof useCreditPricing>;

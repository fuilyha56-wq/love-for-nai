"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreditPricing } from "@/lib/credit-pricing";
import type { DailyImageBillingState } from "@/lib/daily-image-pricing";
import type { ModelPricingSnapshot } from "@/lib/image-pricing";
import type { PublicCatalog } from "@/lib/public-catalog";

type PricingPayload = { message?: string };
type QuoteSnapshot<T> = { url: string; data: T | null; error: string };
type PendingQuote<T> = { url: string; controller: AbortController; promise: Promise<T | null> };

export type ImageQuoteWallet = {
  aff: {
    enabled: boolean;
    balance: number;
    packageBalance: number;
    packageRateLimitRemaining: number;
    totalBalance: number;
  };
  dailyBilling: DailyImageBillingState;
  newApi?: { balance: number; group: string } | null;
};

const LIVE_PRICE_REFRESH_MS = 15_000;
const ACCOUNT_PRICE_REFRESH_MS = 30_000;

function useLiveQuote<T extends PricingPayload>(
  url: string | null,
  validate: (value: T) => boolean,
  refreshMs = LIVE_PRICE_REFRESH_MS,
) {
  const [snapshot, setSnapshot] = useState<QuoteSnapshot<T> | null>(null);
  const pending = useRef<PendingQuote<T> | null>(null);

  const refresh = useCallback((): Promise<T | null> => {
    if (!url) return Promise.resolve(null);
    if (pending.current?.url === url) return pending.current.promise;
    pending.current?.controller.abort();
    const controller = new AbortController();

    const promise = (async () => {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const value = await response.json() as T;
        if (!response.ok || !validate(value))
          throw new Error(value?.message || "暂时无法读取计价数据");
        if (controller.signal.aborted) return null;
        setSnapshot({ url, data: value, error: "" });
        return value;
      } catch (error) {
        if (!controller.signal.aborted) {
          setSnapshot(previous => ({
            url,
            data: previous?.url === url ? previous.data : null,
            error: error instanceof Error ? error.message : "暂时无法读取计价数据",
          }));
        }
        return null;
      } finally {
        if (pending.current?.controller === controller) pending.current = null;
      }
    })();
    pending.current = { url, controller, promise };
    return promise;
  }, [url, validate]);

  useEffect(() => {
    if (!url) return;
    let active = true;
    const refreshVisible = () => {
      if (active && document.visibilityState === "visible") void refresh();
    };
    void Promise.resolve().then(refreshVisible);
    const interval = window.setInterval(refreshVisible, refreshMs);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      if (pending.current?.url === url) {
        pending.current.controller.abort();
        pending.current = null;
      }
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh, refreshMs, url]);

  const current = url && snapshot?.url === url ? snapshot : null;
  return { data: current?.data ?? null, error: current?.error ?? "", loading: Boolean(url && !current), refresh };
}

type NewApiImagePricing = ModelPricingSnapshot & { affFixedCost?: number | null };

const validCreditPricing = (data: CreditPricing) =>
  Boolean(data?.policy && data.fixedCosts && Number.isFinite(data.cnyPerAff) && data.cnyPerAff > 0);
const validCatalog = (data: PublicCatalog) => Array.isArray(data?.models);
const validNewApiPricing = (data: NewApiImagePricing) =>
  typeof data?.model === "string" && Number.isFinite(data.groupRatio);
const validWallet = (data: ImageQuoteWallet) => Boolean(data?.aff && data.dailyBilling?.counts);

export function useCreditPricing() {
  return useLiveQuote<CreditPricing & PricingPayload>("/api/public/credit-pricing", validCreditPricing);
}

export function useLivePublicPricingCatalog() {
  return useLiveQuote<PublicCatalog>("/api/public/catalog", validCatalog, ACCOUNT_PRICE_REFRESH_MS);
}

export function useLiveNewApiPricing(model: string | null) {
  return useLiveQuote<NewApiImagePricing & PricingPayload>(
    model ? "/api/pricing?model=" + encodeURIComponent(model) : null,
    validNewApiPricing,
    ACCOUNT_PRICE_REFRESH_MS,
  );
}

export function useLiveImageQuoteWallet(enabled: boolean) {
  return useLiveQuote<ImageQuoteWallet & PricingPayload>(
    enabled ? "/api/wallet" : null,
    validWallet,
    ACCOUNT_PRICE_REFRESH_MS,
  );
}

export type CreditPricingState = ReturnType<typeof useCreditPricing>;

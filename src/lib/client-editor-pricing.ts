"use client";

import { useCallback } from "react";
import { useCreditPricing, useLiveImageQuoteWallet, useLiveNewApiPricing } from "./client-credit-pricing";
import { formatAff, formatNewApiQuote, quoteCredits } from "./credit-pricing";
import { dailyImageDay, dailyImageFamily, roundAffAmount } from "./daily-image-pricing";
import type { EditorDocument, GenerationViewport } from "./image-editor";
import { estimateNewApiCost, isInFreeEnvelope, modelPointVersion, type ImagePricingGeneration } from "./image-pricing";
import { isNaiLimitModel } from "./nai-image-limits";
import { isNaiMediumModel } from "./nai-native-request";

/** Match the source pixels sampled by the editor when building its request. */
export function editorViewportHasImage(document: EditorDocument, viewport: GenerationViewport, output: { width: number; height: number }): boolean {
  const { image, worldRect } = document;
  const firstX = Math.max(0, Math.floor((worldRect.x - viewport.x) / viewport.width * output.width) - 1);
  const firstY = Math.max(0, Math.floor((worldRect.y - viewport.y) / viewport.height * output.height) - 1);
  for (let y = firstY; y < output.height; y += 1) {
    const sourceY = viewport.y + (y / output.height) * viewport.height - worldRect.y;
    if (sourceY < 0) continue;
    if (sourceY >= image.height) break;
    const row = Math.floor(sourceY) * image.width;
    for (let x = firstX; x < output.width; x += 1) {
      const sourceX = viewport.x + (x / output.width) * viewport.width - worldRect.x;
      if (sourceX < 0) continue;
      if (sourceX >= image.width) break;
      if (image.data[(row + Math.floor(sourceX)) * 4 + 3] > 0) return true;
    }
  }
  return false;
}

export function useEditorPriceQuote(authenticated: boolean, providerId: string, generation: ImagePricingGeneration | null, requestCount: number, generating: boolean) {
  const siteProvider = authenticated && providerId === "newapi";
  const localNai = siteProvider && !!generation && !!modelPointVersion(generation.model);
  const creditPricing = useCreditPricing();
  const wallet = useLiveImageQuoteWallet(localNai);
  const upstream = useLiveNewApiPricing(siteProvider && generation ? generation.model : null);
  const { refresh: refreshPricing } = creditPricing;
  const { refresh: refreshWallet } = wallet;
  const refresh = useCallback(async () => {
    if (localNai) await Promise.all([refreshPricing(), refreshWallet()]);
  }, [localNai, refreshPricing, refreshWallet]);

  const label = (() => {
    if (!generation || !authenticated || generating) return null;
    if (requestCount === 0) return "已完成的分块会复用，继续拼接无需再次生成。";
    if (!siteProvider) return "个人来源按提供方账单计费。";
    if ((isNaiLimitModel(generation.model) && !isInFreeEnvelope(generation)) ||
        (isNaiMediumModel(generation.model) && generation.steps !== 14)) return "当前参数超出所选模型的计费范围。";

    let localCount = 0;
    let upstreamCount = requestCount;
    let packageCost = 0;
    let personalCost = 0;
    let blockedCount = 0;
    if (localNai) {
      const pricing = creditPricing.data;
      const account = wallet.data;
      if (creditPricing.error || wallet.error) return "暂时无法更新本站报价。";
      if (!pricing || !account) return "正在读取本站价格与额度…";
      const strict = pricing.policy.strictApiBilling === true;
      if (!account.aff.enabled && strict) return "本站额度服务暂不可用。";
      if (account.aff.enabled) {
        const day = dailyImageDay();
        const state = { ...account.dailyBilling, day, counts: { ...account.dailyBilling.counts } };
        if (account.dailyBilling.day !== day) state.counts = { v45: 0, v5: 0 };
        const family = dailyImageFamily(generation);
        let packageRemaining = account.aff.packageRateLimitRemaining;
        for (let index = 0; index < requestCount; index += 1) {
          const { costAff } = quoteCredits(generation, pricing, state);
          const fromPackage = packageRemaining > 0 ? roundAffAmount(Math.min(costAff, account.aff.packageBalance - packageCost)) : 0;
          const fromPersonal = roundAffAmount(costAff - fromPackage);
          if (roundAffAmount(personalCost + fromPersonal) > account.aff.balance) break;
          packageCost = roundAffAmount(packageCost + fromPackage);
          personalCost = roundAffAmount(personalCost + fromPersonal);
          if (fromPackage > 0) packageRemaining -= 1;
          if (family) state.counts[family] += 1;
          localCount += 1;
        }
        upstreamCount = strict ? 0 : requestCount - localCount;
        blockedCount = strict ? requestCount - localCount : 0;
      }
    }

    const quoteParts: string[] = [];
    if (localCount > 0) {
      const sources = [packageCost > 0 ? `图包 ${formatAff(packageCost)}` : "", personalCost > 0 ? `个人 ${formatAff(personalCost)}` : ""].filter(Boolean);
      quoteParts.push(`${formatAff(packageCost + personalCost)} AFF${sources.length ? `（${sources.join("，")}）` : ""}`);
    }
    if (upstreamCount > 0) {
      const one = !upstream.error && upstream.data && (localNai || upstream.data.quotaType === 1 || upstream.data.hourlyImagePricing)
        ? estimateNewApiCost(upstream.data, generation) : null;
      const group = upstream.data?.effectiveGroup;
      if (one == null && localCount === 0) return upstream.loading ? "正在读取 NewAPI 账号价格…" : "NewAPI 费用以实际账单为准。";
      quoteParts.push(one == null ? "NewAPI 费用以实际账单为准" : `NewAPI 余额 ${formatNewApiQuote(one * upstreamCount)}${group ? `（${group}）` : ""}`);
    }
    if (blockedCount > 0) quoteParts.push(requestCount > 1 ? `${blockedCount} 块的本站额度不足` : "本站额度不足");
    return `${requestCount > 1 ? `预计 ${requestCount} 块共` : "预计费用"} ${quoteParts.join("；")}`;
  })();

  return { label, refresh };
}

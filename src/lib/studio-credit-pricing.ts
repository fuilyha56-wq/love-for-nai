import { quoteCredits, type CreditPricing } from "./credit-pricing";
import { roundAffAmount } from "./daily-image-pricing";
import { splitImageCreditCost } from "./image-pricing";
import { naiUsageModel } from "./nai-native-request";

type PreparationQuote = { costAff: number; count: number };
type StudioWallet = { packageBalance: number; packageRateLimitRemaining: number };

export function quoteVibePreparation(model: string, count: number, pricing: CreditPricing): PreparationQuote | undefined {
  if (count === 0) return undefined;
  const quote = quoteCredits({
    model: naiUsageModel(model),
    operation: "encode-vibe",
    width: 512,
    height: 512,
    steps: 1,
    samples: 1,
    referenceImageCount: 1,
  }, pricing);
  return { costAff: roundAffAmount(quote.costAff * count), count };
}

function splitPreparation(preparation: PreparationQuote | undefined, wallet: StudioWallet) {
  if (!preparation) return { packageCost: 0, personalCost: 0, packageImages: 0 };
  const split = splitImageCreditCost(
    preparation.costAff, preparation.count, wallet.packageBalance, wallet.packageRateLimitRemaining,
    Array(preparation.count).fill(roundAffAmount(preparation.costAff / preparation.count)),
  );
  return {
    packageCost: split.packageCost,
    personalCost: split.personalCost,
    packageImages: split.packageChargesBySample.filter(cost => cost > 0).length,
  };
}

export function splitStudioCreditQuote(
  generation: ReturnType<typeof quoteCredits>,
  samples: number,
  preparation: PreparationQuote | undefined,
  wallet: StudioWallet,
) {
  const prepared = splitPreparation(preparation, wallet);
  const generationSplit = splitImageCreditCost(
    generation.costAff, samples, roundAffAmount(wallet.packageBalance - prepared.packageCost),
    wallet.packageRateLimitRemaining - prepared.packageImages, generation.daily?.affCosts,
  );
  return {
    packageCost: roundAffAmount(prepared.packageCost + generationSplit.packageCost),
    personalCost: roundAffAmount(prepared.personalCost + generationSplit.personalCost),
    preparationPersonalCost: prepared.personalCost,
  };
}

export function estimateSequentialStudioPayment(
  generation: ReturnType<typeof quoteCredits>,
  samples: number,
  preparation: PreparationQuote | undefined,
  wallet: StudioWallet & { balance: number },
) {
  const prepared = splitPreparation(preparation, wallet);
  if (prepared.personalCost > wallet.balance) return null;

  let packageCost = prepared.packageCost;
  let personalCost = prepared.personalCost;
  let packageImages = wallet.packageRateLimitRemaining - prepared.packageImages;
  let localSamples = 0;
  const fallbackSampleCost = roundAffAmount(generation.costAff / samples);

  for (let index = 0; index < samples; index += 1) {
    const cost = generation.daily?.affCosts[index] ?? fallbackSampleCost;
    const fromPackage = packageImages > 0 ? roundAffAmount(Math.min(cost, wallet.packageBalance - packageCost)) : 0;
    const nextPersonalCost = roundAffAmount(personalCost + cost - fromPackage);
    // A request paid through NewAPI doesn't advance the local daily tier.
    if (nextPersonalCost > wallet.balance) break;
    packageCost = roundAffAmount(packageCost + fromPackage);
    personalCost = nextPersonalCost;
    if (fromPackage > 0) packageImages -= 1;
    localSamples += 1;
  }

  return { localSamples, packageCost, personalCost, costAff: roundAffAmount(packageCost + personalCost) };
}

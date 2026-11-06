import { modelPointVersion, usesLimitPricing, type ImagePricingGeneration } from "./image-pricing";

export type GatewayImageCapacity = {
  total: number;
  v5: number;
  v45: number;
  anlas: number;
  v5_and_anlas: number;
  v45_and_anlas: number;
  concurrency: number;
  capabilityQueue?: boolean;
};

/** Workbench scheduling hint. Gateway still decides admission for the actual request. */
export function gatewayImageConcurrency(
  generation: ImagePricingGeneration,
  capacity: GatewayImageCapacity | null,
): number | undefined {
  const model = generation.model.toLowerCase();
  const version = modelPointVersion(model);
  if (!capacity || !version) return undefined;
  // Older gateways expose a general limit. Direct credential mode has no account breakdown.
  if (!capacity.capabilityQueue || capacity.total === 0) return capacity.concurrency;
  const needsAnlas = !usesLimitPricing({ ...generation, model });
  if (version === "V5") return needsAnlas ? capacity.v5_and_anlas : capacity.v5;
  if (/nai-v4\.5|diffusion-4-5/.test(model)) return needsAnlas ? capacity.v45_and_anlas : capacity.v45;
  return capacity.anlas;
}

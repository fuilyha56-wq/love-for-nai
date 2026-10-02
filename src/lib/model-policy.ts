/**
 * Client-safe NAI model policy primitives.
 *
 * This module must stay free of Node.js, Next.js and server configuration
 * imports so it can be used by the image studio and editor before hydration.
 */
export type NaiModelFamily = "v5" | "v4.5";

export type ModelPolicy = {
  enableV5Models: boolean;
  enableV45Models: boolean;
};

export const DEFAULT_CLIENT_MODEL_POLICY: ModelPolicy = {
  // Before the server policy has been read, only legacy (non V5/V4.5) NAI
  // models are safe to show. This prevents a disabled model flashing in UI.
  enableV5Models: false,
  enableV45Models: false,
};

export function naiModelFamily(model: string): NaiModelFamily | null {
  const id = String(model || "").trim().toLowerCase();
  if (/^(?:nai-)?(?:v5|diffusion[-_.]?5)(?:[-_.]|$)/i.test(id)) return "v5";
  if (/^(?:nai-)?(?:v4[._-]?5|diffusion[-_.]?4[._-]?5)(?:[-_.]|$)/i.test(id)) return "v4.5";
  return null;
}

export function isNaiModelEnabledForPolicy(model: string, policy: ModelPolicy): boolean {
  const family = naiModelFamily(model);
  if (!family) return true;
  return family === "v5" ? policy.enableV5Models : policy.enableV45Models;
}

export function filterNaiModelIds(models: readonly string[], policy: ModelPolicy): string[] {
  return models.filter((model) => isNaiModelEnabledForPolicy(model, policy));
}

export function filterNaiModelOptions<T extends { value: string }>(
  options: readonly T[],
  policy: ModelPolicy,
): T[] {
  return options.filter((option) => isNaiModelEnabledForPolicy(option.value, policy));
}

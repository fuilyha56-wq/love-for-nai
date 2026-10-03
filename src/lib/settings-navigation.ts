export type SettingsSection = "appearance" | "profile" | "models" | "prompts";

export function settingsSectionForHash(hash: string): SettingsSection {
  const value = hash.replace(/^#/, "");
  if (["models", "custom-providers", "story-providers", "api-tokens", "novelai-key", "novelai-account", "local-tagger"].includes(value)) return "models";
  if (value === "profile") return "profile";
  if (value === "prompts") return "prompts";
  return "appearance";
}

export function settingsHashAlias(hash: string): string {
  return hash === "#story-providers" ? "#custom-providers" : hash;
}

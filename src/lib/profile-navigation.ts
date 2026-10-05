export const PROFILE_SECTION_IDS = [
  "profile-rewards",
  "profile-info",
  "profile-security",
] as const;

export type ProfileSectionId = (typeof PROFILE_SECTION_IDS)[number];

export function profileSectionForHash(hash: string): ProfileSectionId {
  const section = hash.replace(/^#/, "");
  return PROFILE_SECTION_IDS.includes(section as ProfileSectionId)
    ? section as ProfileSectionId
    : "profile-rewards";
}

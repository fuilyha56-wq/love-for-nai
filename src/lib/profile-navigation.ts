export const PROFILE_SECTION_IDS = [
  "profile-rewards",
  "profile-redeem",
  "profile-info",
  "account-security",
  "profile-security",
  "profile-tutorials",
] as const;

export type ProfileSectionId = (typeof PROFILE_SECTION_IDS)[number];

export function profileSectionForHash(hash: string): ProfileSectionId {
  const section = hash.replace(/^#/, "");
  return PROFILE_SECTION_IDS.includes(section as ProfileSectionId)
    ? section as ProfileSectionId
    : "profile-rewards";
}

import type { CreatorRewardCampaign } from "./creator-rewards";
import { canonicalGalleryTag } from "./gallery-tags";

export type GallerySubmissionActivity = Pick<CreatorRewardCampaign, "id" | "name" | "endsAt" | "requiredTags" | "excludedTags" | "allowedRatings" | "allowedSources"> & {
  proofBoard?: { name: string; rewards: number[]; consolationReward: number };
};

export function gallerySubmissionOptions(campaigns: CreatorRewardCampaign[], now = Date.now()) {
  const eligible = campaigns.filter(c => c.settlementMode !== "daily" && c.enabled && !c.deletedAt && c.publicVisible !== false);
  const activities: GallerySubmissionActivity[] = eligible.filter(c => (!c.startsAt || Date.parse(c.startsAt) <= now) && (!c.endsAt || Date.parse(c.endsAt) > now) && (!c.settlesAt || Date.parse(c.settlesAt) > now))
    .map(c => ({ id: c.id, name: c.name, endsAt: c.endsAt, requiredTags: c.requiredTags?.length ? c.requiredTags : c.requiredTag ? [c.requiredTag] : [], excludedTags: c.excludedTags, allowedRatings: c.allowedRatings, allowedSources: c.allowedSources,
      proofBoard: c.boards?.find(b => b.id === "verified") }));
  const transitions = eligible.flatMap(c => [c.startsAt, c.endsAt, c.settlesAt]).flatMap(value => value && Date.parse(value) > now ? [Date.parse(value)] : []);
  return { activities, serverTime: now, nextChangeAt: transitions.length ? Math.min(...transitions) : null };
}

export function submissionActivityAllows(activity: GallerySubmissionActivity, item: { tags?: string; rating?: string; source: string }, requireTags = true) {
  if (activity.allowedRatings?.length && !activity.allowedRatings.includes(item.rating as "general")) return false;
  if (activity.allowedSources?.length && !activity.allowedSources.includes(item.source as "local")) return false;
  const tags = new Set((item.tags || "").split(/[,，\n]/).map(canonicalGalleryTag));
  return (!requireTags || !(activity.requiredTags || []).some(tag => !tags.has(canonicalGalleryTag(tag)))) && !(activity.excludedTags || []).some(tag => tags.has(canonicalGalleryTag(tag)));
}

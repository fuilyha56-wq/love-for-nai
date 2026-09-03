import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAdminModules } from "@/lib/admin-modules";
import { affTotals, CHECK_IN_REWARD } from "@/lib/aff";
import { countAnnouncementComments } from "@/lib/announcement-comments";
import { countAnnouncements } from "@/lib/announcements";
import { countGallery } from "@/lib/gallery";
import { countLocalUsers } from "@/lib/local-users";
import { getResolvedPlatformCapabilities, resolvedAuthProviderId } from "@/lib/platform";
import { countReferrals, referralReward } from "@/lib/referral";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const capabilities = await getResolvedPlatformCapabilities();
  const [announcements, comments, gallery, referrals, credits, localUsers] =
    await Promise.all([
      countAnnouncements(),
      countAnnouncementComments(),
      countGallery(),
      countReferrals(),
      affTotals(),
      (await resolvedAuthProviderId()) === "local" ? countLocalUsers() : Promise.resolve(null),
    ]);
  return NextResponse.json({
    capabilities,
    modules: listAdminModules(capabilities),
    health: {
      status: "ok",
      service: "love-for-nai",
      auth: capabilities.auth.provider,
      image: capabilities.image.provider,
    },
    counts: {
      users: localUsers,
      announcements,
      comments,
      gallery,
      referrals,
      creditAccounts: credits.accounts,
    },
    credits: {
      personal: credits.personalCredits,
      packages: credits.packageCredits,
      checkInReward: CHECK_IN_REWARD,
      referralReward: referralReward(),
    },
  });
}

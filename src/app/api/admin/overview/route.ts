import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAdminModules } from "@/lib/admin-modules";
import { affTotals } from "@/lib/aff";
import { runtimeRewards } from "@/lib/runtime-config";
import { countAnnouncementComments } from "@/lib/announcement-comments";
import { countAnnouncements } from "@/lib/announcements";
import { countGallery } from "@/lib/gallery";
import { countLocalUsers } from "@/lib/local-users";
import { getResolvedPlatformCapabilities, resolvedAuthProviderId } from "@/lib/platform";
import { countReferrals } from "@/lib/referral";
import { ACTIVE_SESSION_WARNING_THRESHOLD, summarizeNewApiSessions } from "@/lib/newapi-sessions";
import { newApiDbConfigured } from "@/lib/newapi-db";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const capabilities = await getResolvedPlatformCapabilities();
  const authProvider = await resolvedAuthProviderId();
  const [announcements, comments, gallery, referrals, credits, localUsers, rewards, sessions] =
    await Promise.all([
      countAnnouncements(),
      countAnnouncementComments(),
      countGallery(),
      countReferrals(),
      affTotals(),
      authProvider === "local" ? countLocalUsers() : Promise.resolve(null),
      runtimeRewards(),
      authProvider === "newapi" && newApiDbConfigured()
        ? summarizeNewApiSessions(ACTIVE_SESSION_WARNING_THRESHOLD).catch(() => null)
        : Promise.resolve(null),
    ]);
  return NextResponse.json({
    capabilities,
    modules: listAdminModules(capabilities),
    health: {
      status: "ok",
      service: "love-for-nai",
      auth: capabilities.auth.provider,
      image: capabilities.image.provider,
      sessions: sessions
        ? { ...sessions, configured: true, status: sessions.overThresholdUsers ? "warning" : "ok" }
        : { threshold: ACTIVE_SESSION_WARNING_THRESHOLD, totalActiveSessions: null, usersWithActiveSessions: null, overThresholdUsers: null, configured: false, status: "unavailable" },
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
      checkInReward: rewards.checkInReward,
      referralReward: rewards.referralReward,
      referralEnabled: rewards.referralEnabled,
      checkInEnabled: rewards.checkInEnabled,
    },
  });
}

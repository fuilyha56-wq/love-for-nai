export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build"
  )
    return;

  const { validateSessionConfiguration } = await import("@/lib/session");
  const { startAutomaticCreatorRewardSettlement } = await import("@/lib/creator-rewards");
  const { startAutomaticSessionCleanup } = await import("@/lib/session-cleanup");
  validateSessionConfiguration();
  startAutomaticCreatorRewardSettlement();
  startAutomaticSessionCleanup();
}

"use client";

import { useEffect, type ReactNode } from "react";
import { useMobileViewportMatch, ViewportDeviceProvider } from "./viewport-page";
import { AppearanceProvider } from "./appearance";
import { LfnDialogHost } from "./ui/lfn-dialog";
import { LayoutAnnouncements } from "./layout-announcements";
import { OnboardingGuide } from "./onboarding-guide";
import { AppearanceProvider as MobileAppearanceProvider } from "@/mobile/appearance";
import { LauncherShell } from "@/mobile/launcher-shell";
import { LfnDialogHost as MobileDialogHost } from "@/mobile/ui/lfn-dialog";
import { LayoutAnnouncements as MobileAnnouncements } from "@/mobile/layout-announcements";
import { OnboardingGuide as MobileGuide } from "@/mobile/onboarding-guide";
import { FeatureTutorialGuide } from "./tutorials/feature-tutorial-guide";
import { ViewportDiagnostics } from "@/mobile/ui/viewport-diagnostics";

export function ViewportRoot({ children }: { children: ReactNode }) {
  const mobile = useMobileViewportMatch();
  useEffect(() => {
    document.documentElement.dataset.clientViewport = mobile ? "mobile" : "desktop";
    document.documentElement.dataset.viewportReady = "true";
  }, [mobile]);
  return <ViewportDeviceProvider mobile={mobile}>{mobile
    ? <MobileAppearanceProvider><LauncherShell>{children}</LauncherShell><MobileDialogHost /><MobileAnnouncements /><MobileGuide /></MobileAppearanceProvider>
    : <AppearanceProvider>{children}<LfnDialogHost /><LayoutAnnouncements /><OnboardingGuide /></AppearanceProvider>
  }<FeatureTutorialGuide /><ViewportDiagnostics /></ViewportDeviceProvider>;
}

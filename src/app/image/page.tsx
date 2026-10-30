import type { Viewport } from "next";
import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/image/page";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The workspace sizes its body portal from VisualViewport. Keep the layout
// viewport stable so the IME does not also resize fixed layers and CSS units.
export const viewport: Viewport = { interactiveWidget: "resizes-visual" };

export default function Page(props: PageProps<"/image">) {
  return <ViewportPage desktop={<DesktopPage {...props} />} mobile={<MobilePage {...props} />} />;
}

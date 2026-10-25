import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/stories/page";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <ViewportPage desktop={<DesktopPage />} mobile={<MobilePage />} />;
}

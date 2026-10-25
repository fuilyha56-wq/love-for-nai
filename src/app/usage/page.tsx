import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/usage/page";


export default function Page() {
  return <ViewportPage desktop={<DesktopPage />} mobile={<MobilePage />} />;
}

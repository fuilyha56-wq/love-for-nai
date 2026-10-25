import { ViewportPage } from "./viewport-page";
import DesktopNotFound from "./desktop-not-found";
import MobileNotFound from "@/mobile/not-found";
export default function NotFound() { return <ViewportPage desktop={<DesktopNotFound />} mobile={<MobileNotFound />} />; }

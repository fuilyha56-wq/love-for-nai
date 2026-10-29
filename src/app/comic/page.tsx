import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/comic/page";

export default function Page() { return <ViewportPage desktop={<DesktopPage/>} mobile={<MobilePage/>}/>; }

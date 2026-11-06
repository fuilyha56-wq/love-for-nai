import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/history/page";
import { getSession } from "@/lib/session";


export default async function Page() {
  const ownerId = (await getSession())?.userId ?? 0;
  return <ViewportPage desktop={<DesktopPage key={ownerId} ownerId={ownerId} />} mobile={<MobilePage />} />;
}

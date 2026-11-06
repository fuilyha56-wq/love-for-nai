import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/image/editor/history/page";
import { getSession } from "@/lib/session";


export default async function Page() {
  const ownerId = (await getSession())?.userId ?? 0;
  return <ViewportPage desktop={<DesktopPage ownerId={ownerId} />} mobile={<MobilePage ownerId={ownerId} />} />;
}

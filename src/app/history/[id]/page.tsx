import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/history/[id]/page";
import { getSession } from "@/lib/session";


export default async function Page({ params }: PageProps<"/history/[id]">) {
  const ownerId = (await getSession())?.userId ?? 0;
  return <ViewportPage desktop={<DesktopPage params={params} ownerId={ownerId} />} mobile={<MobilePage params={params} ownerId={ownerId} />} />;
}

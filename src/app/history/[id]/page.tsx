import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/history/[id]/page";


export default function Page(props: PageProps<"/history/[id]">) {
  return <ViewportPage desktop={<DesktopPage {...props} />} mobile={<MobilePage {...props} />} />;
}

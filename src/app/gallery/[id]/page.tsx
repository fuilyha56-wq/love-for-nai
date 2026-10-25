import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/gallery/[id]/page";


export default function Page(props: PageProps<"/gallery/[id]">) {
  return <ViewportPage desktop={<DesktopPage {...props} />} mobile={<MobilePage {...props} />} />;
}

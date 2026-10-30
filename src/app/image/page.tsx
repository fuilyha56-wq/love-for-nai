import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/image/page";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page(props: PageProps<"/image">) {
  return <ViewportPage desktop={<DesktopPage {...props} />} mobile={<MobilePage {...props} />} />;
}

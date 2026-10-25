import { ViewportPage } from "@/app/viewport-page";
import DesktopPage from "./desktop-page";
import MobilePage from "@/mobile/admin/credits/users/[id]/ledger/page";


export default function Page(props: PageProps<"/admin/credits/users/[id]/ledger">) {
  return <ViewportPage desktop={<DesktopPage {...props} />} mobile={<MobilePage {...props} />} />;
}

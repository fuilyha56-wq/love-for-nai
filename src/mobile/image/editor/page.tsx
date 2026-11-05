import { getSession } from "@/lib/session";
import EditorClient from "./editor";
import { MobileEditorErrorBoundary } from "./error-boundary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ImageEditorPage() {
  const session = await getSession();
  return <MobileEditorErrorBoundary><EditorClient authenticated={Boolean(session)} userId={session?.userId} /></MobileEditorErrorBoundary>;
}

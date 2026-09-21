import { getSession } from "@/lib/session";
import EditorClient from "./editor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ImageEditorPage() {
  const session = await getSession();
  return <EditorClient authenticated={Boolean(session)} />;
}

import { getSession } from "@/lib/session";
import { ComicWorkspace } from "./comic-workspace";

export default async function DesktopPage() {
  const session = await getSession();
  return <ComicWorkspace owner={session ? String(session.userId) : "guest"}/>;
}

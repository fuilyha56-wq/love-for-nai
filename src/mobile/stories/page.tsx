import { getSession } from "@/lib/session";
import StoriesWorkspace from "./stories-workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StoriesPage() {
  const session = await getSession();
  return (
    <StoriesWorkspace
      userName={session?.displayName || "体验用户"}
      authenticated={Boolean(session)}
    />
  );
}
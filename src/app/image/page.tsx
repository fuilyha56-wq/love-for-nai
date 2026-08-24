import { getSession } from "@/lib/session";
import ImageStudio from "./studio";

export default async function ImagePage() {
  const session = await getSession();
  return (
    <ImageStudio
      userName={session?.displayName || "体验用户"}
      authenticated={Boolean(session)}
    />
  );
}

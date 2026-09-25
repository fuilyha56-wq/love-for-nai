import { getSession } from "@/lib/session";
import ImageStudio from "./studio";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ImagePage({
  searchParams,
}: {
  searchParams: Promise<{ layoutEditor?: string | string[] }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const layoutEditor = params.layoutEditor === "1" || (Array.isArray(params.layoutEditor) && params.layoutEditor.includes("1"));
  return (
    <ImageStudio
      userName={session?.displayName || "体验用户"}
      authenticated={Boolean(session)}
      layoutEditor={layoutEditor}
    />
  );
}

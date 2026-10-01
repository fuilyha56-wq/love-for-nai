import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import ImageStudio from "./studio";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ImagePage({
  searchParams,
}: {
  searchParams: Promise<{ layoutEditor?: string | string[] }>;
}) {
  const params = await searchParams;
  const layoutEditor = params.layoutEditor === "1" || (Array.isArray(params.layoutEditor) && params.layoutEditor.includes("1"));
  if (layoutEditor) redirect("/image/setting/layout");
  const session = await getSession();
  return (
    <ImageStudio
      userName={session?.displayName || "体验用户"}
      authenticated={Boolean(session)}
    />
  );
}

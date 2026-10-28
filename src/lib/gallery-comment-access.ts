import { getGalleryItem } from "@/lib/gallery";
import { getSession } from "@/lib/session";
import { requireAdmin } from "@/lib/admin-auth";

export async function galleryCommentAccess(id: string) {
  const [item, session] = await Promise.all([getGalleryItem(id), getSession()]);
  if (!item) return null;
  const owner = session?.userId === item.ownerId;
  const admin = session && !owner ? !("error" in await requireAdmin()) : false;
  if (item.status !== "approved" && !owner && !admin) return null;
  return { item, session, canModerate: owner || admin };
}

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";

export default async function ActivitiesPage() {
  const gate = await requireAdmin();
  if ("error" in gate) redirect("/sign-in?next=%2Fadmin%3Ftab%3Dactivities");
  redirect("/admin?tab=activities");
}

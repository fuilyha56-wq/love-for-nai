import { redirect } from "next/navigation";

export default function CustomLayoutPage() {
  redirect("/image?layoutEditor=1");
}

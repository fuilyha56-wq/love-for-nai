"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** All mobile history entries use the studio's history gallery and actions. */
export default function HistoryPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/image?view=history"); }, [router]);
  return <p role="status">正在打开历史画廊…</p>;
}

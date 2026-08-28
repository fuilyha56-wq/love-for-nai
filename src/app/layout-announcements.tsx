"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AnnouncementDialog,
  type AnnouncementItem,
} from "@/app/announcement-dialog";

// 全局公告：服务端组件 layout 挂载后，在客户端拉取公告并弹窗展示。
// 弹窗仅在登录页之外出现，避免挡住登录表单。
export function LayoutAnnouncements() {
  const router = useRouter();
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [path, setPath] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return;
        setPath(window.location.pathname);
      })
      .catch(() => undefined);
    fetch("/api/announcements", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!cancelled) setItems(result.items || []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items.length || path.startsWith("/sign-in")) return null;

  return (
    <AnnouncementDialog
      items={items}
      onOpenList={() => router.push("/announcements")}
    />
  );
}

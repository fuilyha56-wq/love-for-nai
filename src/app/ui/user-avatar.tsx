"use client";
import { useEffect, useState } from "react";

export function UserAvatar({ userId, name, size = 40 }: { userId: number; name: string; size?: number }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const update = (event: Event) => { if ((event as CustomEvent).detail?.userId === userId) setVersion(Date.now()); };
    window.addEventListener("lfn-avatar-updated", update);
    return () => window.removeEventListener("lfn-avatar-updated", update);
  }, [userId]);
  // Public avatars use a bounded, server-compressed image endpoint.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/users/${userId}/avatar?v=${version}`} alt={`${name}的头像`} width={size} height={size} loading="lazy" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "var(--surface-muted)" }} />;
}

"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { fetchCachedImageBlob, isCacheableImage } from "@/lib/browser-image-cache";

const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fill?: boolean;
  unoptimized?: boolean;
  priority?: boolean;
};

/** No remote src is assigned until IndexedDB has been checked. */
export default function CachedImage({ src, alt = "", fill, unoptimized: _unoptimized, priority, loading, style, onLoad, ...props }: Props) {
  void _unoptimized;
  const element = useRef<HTMLImageElement>(null);
  const [cached, setCached] = useState({ source: "", url: "" });
  const persistent = isCacheableImage(src);
  const resolved = persistent ? cached.source === src ? cached.url : "" : src;

  useEffect(() => {
    if (!persistent) return;
    let active = true;
    let objectUrl = "";
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void fetchCachedImageBlob(src).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setCached({ source: src, url: objectUrl });
      }).catch(() => {
        // Leave network retries to an explicit reload instead of requesting the
        // same missing original a second time via the img element.
        if (active) setCached({ source: src, url: "data:image/png;base64,!" });
      });
    };
    let observer: IntersectionObserver | undefined;
    if (priority || loading === "eager" || typeof IntersectionObserver === "undefined") load();
    else if (element.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); load(); }
      }, { rootMargin: "400px" });
      observer.observe(element.current);
    }
    return () => {
      active = false;
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, persistent, priority, loading]);

  // eslint-disable-next-line @next/next/no-img-element -- persistent Blob URLs preserve the source's natural aspect ratio
  return <img {...props} alt={alt} ref={element} src={resolved || PLACEHOLDER} loading={priority ? "eager" : loading || "lazy"} aria-busy={persistent && !resolved || undefined} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style} onLoad={(event) => { if (resolved) onLoad?.(event); }} />;
}

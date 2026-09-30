"use client";

import Image from "next/image";
import { Brush, Dice5, Download, ImageIcon, ImagePlus, Maximize2, Ruler, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import "./replica-media.css";

export type ReplicaMediaProps = {
  variant: "nai" | "nlw";
  images: string[];
  width: number;
  height: number;
  seed: string;
  progress?: string;
  onOpen: (index: number) => void;
  onUse: (image: string, operation: string) => void;
};

/** The image is fitted into the preview space without changing its pixels. */
export function fitMediaSize(width: number, height: number, availableWidth: number, availableHeight: number): { width: number; height: number } {
  if (![width, height, availableWidth, availableHeight].every(Number.isFinite) ||
    Math.min(width, height, availableWidth, availableHeight) <= 0) return { width: 0, height: 0 };
  const scale = Math.min(availableWidth / width, availableHeight / height);
  return { width: width * scale, height: height * scale };
}

export function resolveMediaColumns(imageCount: number, availableWidth: number): number {
  const ideal = imageCount <= 1 ? 1 : imageCount <= 4 ? 2 : imageCount <= 6 ? 3 : 4;
  const usable = Math.max(0, Number.isFinite(availableWidth) ? availableWidth - 16 : 0);
  return Math.min(ideal, Math.max(1, Math.floor((usable + 12) / (150 + 12))));
}

export function ReplicaMedia({ variant, images, width, height, seed, progress, onOpen, onUse }: ReplicaMediaProps): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState(() => new Map<string, { width: number; height: number }>());
  const firstImage = images[0];
  const fallbackWidth = Math.max(1, width);
  const fallbackHeight = Math.max(1, height);
  const firstNatural = natural.get(firstImage);
  const imageWidth = firstNatural?.width ?? fallbackWidth;
  const imageHeight = firstNatural?.height ?? fallbackHeight;
  const fitted = fitMediaSize(imageWidth, imageHeight, available.width, available.height);
  const singleStyle: CSSProperties = fitted.width > 0
    ? { width: fitted.width, height: fitted.height }
    : { width: imageWidth, aspectRatio: `${imageWidth} / ${imageHeight}`, maxWidth: "100%", maxHeight: "100%" };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const styles = getComputedStyle(stage);
      const next = {
        width: Math.max(0, stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)),
        height: Math.max(0, stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom)),
      };
      setAvailable((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [images.length]);

  function imageCard(image: string, index: number, single: boolean): ReactElement {
    const dimensions = natural.get(image);
    const cardWidth = dimensions?.width ?? fallbackWidth;
    const cardHeight = dimensions?.height ?? fallbackHeight;
    return (
      <div className="replica-media-card" key={`${index}-${image}`} style={single ? singleStyle : { aspectRatio: `${cardWidth} / ${cardHeight}` }}>
        <button className="replica-media-open" type="button" aria-label={`放大查看第 ${index + 1} 张图像`} onClick={() => onOpen(index)}>
          <Image
            src={image}
            alt={`生成结果 ${index + 1}`}
            width={cardWidth}
            height={cardHeight}
            unoptimized
            onLoad={(event) => {
              const loaded = event.currentTarget;
              if (loaded.naturalWidth > 0 && loaded.naturalHeight > 0) {
                const dimensions = { width: loaded.naturalWidth, height: loaded.naturalHeight };
                setNatural((previous) => {
                  const recorded = previous.get(image);
                  if (recorded?.width === dimensions.width && recorded.height === dimensions.height) return previous;
                  const next = new Map<string, { width: number; height: number }>();
                  // Stream preview URLs change frequently; retain only this collection.
                  for (const currentImage of images) {
                    const cached = previous.get(currentImage);
                    if (cached) next.set(currentImage, cached);
                  }
                  next.set(image, dimensions);
                  return next;
                });
              }
            }}
          />
        </button>
        <div className="replica-media-actions" role="group" aria-label={`第 ${index + 1} 张图像操作`}>
          <a href={image} download={`lfn-${index + 1}.png`} aria-label={`下载第 ${index + 1} 张图像`} title="保存图像"><Download size={16} /></a>
          <button type="button" title="用于图生图" aria-label={`第 ${index + 1} 张用于图生图`} onClick={() => onUse(image, "img2img")}><ImagePlus size={16} /></button>
          <button type="button" title="用于局部重绘" aria-label={`第 ${index + 1} 张用于局部重绘`} onClick={() => onUse(image, "inpainting")}><Brush size={16} /></button>
          <button type="button" title="用于导演工具" aria-label={`第 ${index + 1} 张用于导演工具`} onClick={() => onUse(image, "director-lineart")}><WandSparkles size={16} /></button>
          <button type="button" title="用作 Vibe 参考" aria-label={`第 ${index + 1} 张用作 Vibe 参考`} onClick={() => onUse(image, "vibe-transfer")}><Sparkles size={16} /></button>
          <button type="button" title="放大图像" aria-label={`第 ${index + 1} 张用于放大`} onClick={() => onUse(image, "upscale")}><Maximize2 size={16} /></button>
        </div>
      </div>
    );
  }

  return (
    <section className={`replica-media replica-media-${variant}`} aria-label="生成结果预览">
      <div ref={stageRef} className={`replica-media-stage${images.length > 1 ? " is-batch" : ""}`}>
        {images.length === 1 ? imageCard(firstImage, 0, true) : images.length > 1 ? (
          <div className="replica-media-grid" style={{ gridTemplateColumns: `repeat(${resolveMediaColumns(images.length, available.width)}, minmax(0, 1fr))` }}>
            {images.map((image, index) => imageCard(image, index, false))}
          </div>
        ) : (
          <div className="replica-media-empty">
            <ImageIcon size={64} strokeWidth={2.5} />
            <p>输入提示词并点击生成</p>
            <small>图像将在这里显示</small>
          </div>
        )}
      </div>
      {progress && <div className="replica-media-progress" role="status">{progress}</div>}
      {images.length > 0 && <footer className="replica-media-info">
        <span><Ruler size={14} />{imageWidth} × {imageHeight}</span>
        <span><Dice5 size={14} />{seed || "随机种子"}</span>
        {images.length > 1 && <span>{images.length} 张图像</span>}
      </footer>}
    </section>
  );
}

export default ReplicaMedia;

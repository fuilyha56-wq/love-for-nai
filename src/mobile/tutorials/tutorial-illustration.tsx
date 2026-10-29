import Image from "next/image";
import type { FeatureTutorial, TutorialStep } from "@/lib/feature-tutorials";

export function TutorialIllustration({ tutorial, step, index }: { tutorial: FeatureTutorial; step: TutorialStep; index: number }) {
  const screenshot = step.screenshot;
  if (!screenshot) return <figure className="mobile-tutorial-illustration"><figcaption>本步骤的实际操作截图正在更新。</figcaption></figure>;
  return <figure className="mobile-tutorial-illustration">
    <a href={screenshot.src} target="_blank" rel="noreferrer" aria-label={`放大查看：${tutorial.title}第 ${index + 1} 步`}>
      <Image data-tutorial-shot src={screenshot.src} alt={screenshot.alt} width={screenshot.width || 1440} height={screenshot.height || 900} unoptimized />
    </a>
    <figcaption>{screenshot.caption || `实际页面截图 · 第 ${index + 1} 步：${step.title}`} · 点击图片可放大查看。</figcaption>
  </figure>;
}

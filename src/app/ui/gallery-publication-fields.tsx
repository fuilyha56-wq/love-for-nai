"use client";
import { useEffect, useId, useRef, useState } from "react";
import { PopupSelect } from "@/app/ui/popup-select";
import styles from "@/app/ui/discovery-controls.module.css";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";
import { hasReadableGenerationMetadata } from "@/lib/gallery-publication";
import { useGallerySubmissionOptions } from "@/app/gallery/use-gallery-submission-options";
import { submissionActivityAllows } from "@/lib/gallery-submission-options";
import { canonicalGalleryTag } from "@/lib/gallery-tags";
import type {
  GalleryPublicationInput,
  GalleryPromptMode,
} from "@/lib/gallery-publication";

type Form = GalleryPublicationInput & {
  exposeParameters: boolean;
  requireLikeForParameters?: boolean;
  file?: File;
  files?: File[];
  historyId?: string;
  source: string;
  originalFile?: File;
  tags?: string;
  rating?: string;
};
const publicationModes = [
  { value: "full", label: "完整公开原数据" },
  { value: "partial", label: "部分公开提示词（手动填写并校验）" },
  { value: "hidden", label: "不公开提示词" },
  { value: "none", label: "无原数据图" },
];
export function GalleryPublicationFields({
  form,
  onChange,
  allowOriginalProof = false,
  Select = PopupSelect,
}: {
  form: Form;
  allowOriginalProof?: boolean;
  Select?: typeof PopupSelect;
  onChange: (
    patch: GalleryPublicationInput & {
      exposeParameters?: boolean;
      requireLikeForParameters?: boolean;
      originalFile?: File;
      tags?: string;
    },
  ) => void;
}) {
  const publicationModeId = useId();
  const [detected, setDetected] = useState("");
  const options = useGallerySubmissionOptions(allowOriginalProof);
  const activities = options.activities.filter(activity => submissionActivityAllows(activity, form, false));
  const proofActivity = activities.find(activity => activity.proofBoard && submissionActivityAllows(activity, form));
  const files = form.files?.length ? form.files : form.file ? [form.file] : [];
  const first = files[0];
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    let alive = true;
    if (!first || form.source === "lfn") return;
    void first
      .arrayBuffer()
      .then((buffer) => {
        const metadata = parseNaiImageMetadata(new Uint8Array(buffer));
        const readable = Boolean(
          metadata?.isNai && hasReadableGenerationMetadata(metadata.parameters),
        );
        if (alive)
          setDetected(
            readable
              ? `已读取 ${first.name} 的原始生成元数据。最终分类由服务端验证。`
              : `${first.name} 未读取到有效原始生成元数据，提交后会自动归入“无原数据图”。`,
          );
      })
      .catch(() => {
        if (alive) setDetected("图片检测未完成，提交时由服务端检查。");
      });
    return () => {
      alive = false;
    };
  }, [first, form.source, form.originalFile]);
  useEffect(() => {
    if (!options.loading && (!proofActivity || files.length > 1) && form.originalFile) change.current({ originalFile: undefined });
  }, [options.loading, proofActivity, files.length, form.originalFile]);
  const mode = form.promptMode || (form.exposeParameters ? "full" : "hidden");
  const characters = form.partialCharacters || [];
  return (
    <fieldset className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
      <legend className="px-1 text-sm font-semibold">
        原数据与提示词公开方式
      </legend>
      {activities.length > 0 && <section className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3" aria-label="当前投稿活动">
        <h3 className="text-sm font-semibold">当前开放的活动</h3>
        {activities.map(activity => <div key={activity.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--surface-muted)] p-2 text-xs">
          <div className="min-w-0"><strong className="block">{activity.name}</strong><span className="text-[var(--muted)]">{activity.requiredTags?.length ? `活动标签：${activity.requiredTags.join("、")}` : "符合条件的投稿可参与"}</span></div>
          <button type="button" className="min-h-9 shrink-0 rounded-md border border-[var(--line)] px-3 font-semibold" disabled={submissionActivityAllows(activity, form)} onClick={() => {
            const tags = (form.tags || "").split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean);
            const existing = new Set(tags.map(canonicalGalleryTag));
            change.current({ tags: [...tags, ...(activity.requiredTags || []).filter(tag => !existing.has(canonicalGalleryTag(tag)))].join(", ") });
          }}>{submissionActivityAllows(activity, form) ? "已匹配" : "添加活动标签"}</button>
        </div>)}
      </section>}
      {proofActivity && (
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
          <label className="block text-sm font-semibold">
            校验原图（可选）
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={files.length > 1}
              className="mt-2 block w-full text-xs"
              onChange={(event) =>
                change.current({
                  originalFile: event.target.files?.[0],
                  ...(event.target.files?.[0]
                    ? {
                        promptMode: "none",
                        exposeParameters: false,
                        requireLikeForParameters: false,
                      }
                    : {}),
                })
              }
            />
          </label>
          <p className="text-xs leading-5 text-[var(--muted)]">
            {files.length > 1 ? "原图校验需逐件投稿，请先只选择一张参赛图。" : `为“${proofActivity.name}”提供携带生成元数据的校验原图。原图仅管理员可见，审核通过后按“${proofActivity.proofBoard!.name}”规则参赛。`}
            {files.length <= 1 && ` 名次奖励：${proofActivity.proofBoard!.rewards.join(" / ")} AFF；参与奖励：${proofActivity.proofBoard!.consolationReward} AFF。`}
          </p>
          {form.originalFile && (
            <p className="break-all text-xs">
              已选择校验原图：{form.originalFile.name}
            </p>
          )}
        </div>
      )}
      {detected && first && form.source !== "lfn" && (
        <p
          className="break-words text-xs leading-5 text-[var(--muted)]"
          role="status"
        >
          {detected}
          {files.length > 1 ? " 批量上传将逐张检测和分类。" : ""}
        </p>
      )}
      <div className="text-sm">
        <label htmlFor={publicationModeId}>公开方式</label>
        <Select
          id={publicationModeId}
          ariaLabel="公开方式"
          className={`mt-2 ${styles.select}`}
          menuClassName={styles.menu}
          menuMinWidth={260}
          value={mode}
          options={publicationModes}
          onChange={(value) => {
            const promptMode = value as GalleryPromptMode;
            change.current({
              promptMode,
              exposeParameters:
                promptMode === "full" || promptMode === "partial",
              requireLikeForParameters: false,
            });
          }}
        />
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">
        无法读取生成元数据时会自动归类为无原数据图。公开方式决定其他用户能查看和复用的提示词；活动资格以当前活动规则及审核结果为准。
      </p>
      {mode === "partial" && (
        <div className="space-y-3">
          <p className="text-xs leading-5">
            只能删减原图已有内容，不得新增、改写、改变权重或增加重复次数。无可验证原数据时无法使用部分公开。
          </p>
          <label className="block text-sm">
            公开的正向提示词
            <textarea
              className="field mt-1 min-h-24 w-full p-3"
              value={form.partialPrompt || ""}
              maxLength={20_000}
              onChange={(e) =>
                change.current({ partialPrompt: e.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            公开的负向提示词
            <textarea
              className="field mt-1 min-h-20 w-full p-3"
              value={form.partialNegativePrompt || ""}
              maxLength={20_000}
              onChange={(e) =>
                change.current({ partialNegativePrompt: e.target.value })
              }
            />
          </label>
          {characters.map((character, index) => (
            <div
              key={index}
              className="space-y-2 rounded border border-[var(--line)] p-3"
            >
              <label className="block text-sm">
                来源角色
                <select
                  className="field ml-2 p-1"
                  value={character.sourceIndex}
                  onChange={(e) =>
                    change.current({
                      partialCharacters: characters.map((c, i) =>
                        i === index
                          ? { ...c, sourceIndex: Number(e.target.value) }
                          : c,
                      ),
                    })
                  }
                >
                  {Array.from({ length: 6 }, (_, n) => (
                    <option key={n} value={n}>
                      角色 {n + 1}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                aria-label={`角色 ${character.sourceIndex + 1} 公开正向提示词`}
                className="field w-full p-2"
                placeholder="该角色的正向提示词"
                value={character.prompt}
                onChange={(e) =>
                  change.current({
                    partialCharacters: characters.map((c, i) =>
                      i === index ? { ...c, prompt: e.target.value } : c,
                    ),
                  })
                }
              />
              <textarea
                aria-label={`角色 ${character.sourceIndex + 1} 公开负向提示词`}
                className="field w-full p-2"
                placeholder="该角色的负向提示词"
                value={character.negativePrompt}
                onChange={(e) =>
                  change.current({
                    partialCharacters: characters.map((c, i) =>
                      i === index
                        ? { ...c, negativePrompt: e.target.value }
                        : c,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="text-xs"
                onClick={() =>
                  change.current({
                    partialCharacters: characters.filter((_, i) => i !== index),
                  })
                }
              >
                移除此角色
              </button>
            </div>
          ))}
          {characters.length < 6 && (
            <button
              type="button"
              className="lfn-button"
              onClick={() =>
                change.current({
                  partialCharacters: [
                    ...characters,
                    {
                      sourceIndex:
                        Array.from({ length: 6 }, (_, n) => n).find(
                          (n) => !characters.some((c) => c.sourceIndex === n),
                        ) || 0,
                      prompt: "",
                      negativePrompt: "",
                    },
                  ],
                })
              }
            >
              添加公开角色提示词
            </button>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.upscaled === true}
          onChange={(e) => change.current({ upscaled: e.target.checked })}
        />
        这是超分后的图片
      </label>
      {(mode === "full" || mode === "partial") && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.requireLikeForParameters === true}
            onChange={(e) =>
              change.current({ requireLikeForParameters: e.target.checked })
            }
          />
          点赞后查看已公开的提示词
        </label>
      )}
    </fieldset>
  );
}

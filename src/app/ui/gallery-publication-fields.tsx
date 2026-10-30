"use client";
import { useEffect, useId, useRef, useState } from "react";
import { PopupSelect } from "@/app/ui/popup-select";
import styles from "@/app/ui/discovery-controls.module.css";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";
import { hasReadableGenerationMetadata } from "@/lib/gallery-publication";
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
    },
  ) => void;
}) {
  const publicationModeId = useId();
  const [detected, setDetected] = useState("");
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
              : `${first.name} 未读取到有效原始生成元数据，提交后会自动归入“无原数据图”。${form.originalFile ? "校验原图通过数据校验和关联审核后，按 0.3 倍档参赛。" : "未提供合格校验原图时按低奖励档参赛。"}`,
          );
      })
      .catch(() => {
        if (alive) setDetected("图片检测未完成，提交时由服务端检查。");
      });
    return () => {
      alive = false;
    };
  }, [first, form.source, form.originalFile]);
  const mode = form.promptMode || (form.exposeParameters ? "full" : "hidden");
  const characters = form.partialCharacters || [];
  return (
    <fieldset className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-4">
      <legend className="px-1 text-sm font-semibold">
        原数据与提示词公开方式
      </legend>
      {allowOriginalProof && (
        <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
          <label className="block text-sm font-semibold">
            校验原图（可选）
            <input
              type="file"
              accept="image/png,image/jpeg"
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
            主上传区放修改后的参赛图；这里另传一张带原始生成元数据的原图。原图仅管理员可见，经数据校验与创作关联审核后进入
            0.3 倍中间档：900 / 300 / 30 AFF，安慰奖 15 AFF。广场只展示参赛图。
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
        无法读取原始生成元数据时会自动归类为无原数据图。提供校验原图并通过审核时进入
        0.3
        倍档；否则完整公开且非超分作品进入正常榜，部分公开、不公开、无原数据及超分图进入低档。
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
        这是超分后的图片（按低奖励档参赛）
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
      <p className="text-xs leading-5 text-[var(--muted)]">
        参与万圣节活动请在作品标签中加入“万圣节”或
        halloween；无需填写进生成提示词。
      </p>
    </fieldset>
  );
}

"use client";
import { metadataRestoreFields, type MetadataRestorePreferences } from "@/lib/client-metadata-restore";
import "./metadata-restore-control.css";

const labels = { prompts: "正面与负面提示词", model: "模型、来源与画质", dimensions: "图片尺寸", sampling: "步数、采样与引导值", seed: "种子", characters: "角色与位置" };
export function MetadataRestoreControl({ preferences, onChange }: { preferences: MetadataRestorePreferences; onChange: (field: keyof MetadataRestorePreferences, enabled: boolean) => void }) {
  return <details className="metadata-restore-control"><summary>历史参数复用</summary><p>下次复用历史图片时应用勾选项。选择保存在本机。</p><fieldset><legend>要恢复的内容</legend>{metadataRestoreFields.map((field) => <label key={field}><input type="checkbox" checked={preferences[field]} onChange={(event) => onChange(field, event.target.checked)}/>{labels[field]}</label>)}</fieldset></details>;
}

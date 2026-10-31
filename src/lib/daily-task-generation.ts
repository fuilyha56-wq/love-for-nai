import type { RequestAuditRecord } from "@/lib/request-audit";

export function dailyTaskGeneration(record: RequestAuditRecord) {
  const generatedSamples = record.generatedSamples ?? record.historyIds.length;
  if (
    !record.userId ||
    !record.status ||
    record.status < 200 ||
    record.status >= 300 ||
    record.moderation === "denied" ||
    ![
      "generate",
      "img2img",
      "inpaint",
      "inpainting",
      "edits",
      "outpainting",
      "vibe-transfer",
      "character-reference",
      "precise-reference",
    ].includes(record.operation || "") ||
    !Number.isSafeInteger(generatedSamples) ||
    generatedSamples <= 0
  )
    return null;
  return {
    userId: record.userId,
    requestId: record.requestId,
    generatedSamples,
    at: Date.parse(record.createdAt),
  };
}

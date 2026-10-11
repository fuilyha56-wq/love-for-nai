export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseResponse(stream: ReadableStream<Uint8Array>, headers?: HeadersInit): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...headers,
    },
  });
}

export async function consumeImageStream(
  response: Response,
  options: {
    expected: number;
    onPreview: (images: string[]) => void;
    onProgress: (label: string) => void;
    onComplete?: (historyIds: string[], requestId?: string) => void;
  },
): Promise<string[]> {
  if (!response.body) throw new Error("上游未返回流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";
  const previews: string[] = Array.from({ length: options.expected }, () => "");
  const finals: string[] = Array.from({ length: options.expected }, () => "");
  let errorMessage = "";
  let ended = false;
  const applySlot = (target: string[], sampleIndex: number, image: string) => {
    const index = Math.max(0, sampleIndex);
    while (target.length <= index) target.push("");
    target[index] = image;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      ended = done;
      leftover += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = leftover.split("\n\n");
      leftover = done ? "" : blocks.pop() || "";
      for (const block of blocks) {
        const eventMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*(.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        const event = eventMatch[1].trim();
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataMatch[1]) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event === "error") {
          errorMessage = String(payload.message || "流式生成失败");
          continue;
        }
        if (event === "preview" || event === "final") {
          const image = typeof payload.image === "string" ? payload.image : "";
          const sampleIndex = typeof payload.sampleIndex === "number" ? payload.sampleIndex : 0;
          if (!image) continue;
          if (event === "final") applySlot(finals, sampleIndex, image);
          else applySlot(previews, sampleIndex, image);
          const visible = (event === "final" ? finals : previews).filter(Boolean);
          options.onPreview(visible.length ? visible : [image]);
          const currentStep = typeof payload.currentStep === "number" ? payload.currentStep : 0;
          const totalSteps = typeof payload.totalSteps === "number" ? payload.totalSteps : 0;
          if (totalSteps) options.onProgress(`${Math.min(currentStep, totalSteps)}/${totalSteps} 步`);
        }
        if (event === "done") {
          if (errorMessage) throw new Error(errorMessage);
          const images = Array.isArray(payload.images)
            ? payload.images.filter((item): item is string => typeof item === "string" && Boolean(item))
            : [];
          const historyIds = Array.isArray(payload.historyIds)
            ? payload.historyIds.filter((item): item is string => typeof item === "string")
            : [];
          options.onComplete?.(historyIds, typeof payload.requestId === "string" ? payload.requestId : undefined);
          const completed = images.length ? images : finals.filter(Boolean);
          if (completed.length) options.onPreview(completed);
          return completed;
        }
      }
      if (done) break;
    }
  } finally {
    if (!ended) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (errorMessage) throw new Error(errorMessage);
  return finals.filter(Boolean);
}

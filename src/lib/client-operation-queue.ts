export type OperationStatus = "queued" | "running" | "cancelling" | "completed" | "cancelled" | "failed";
export type OperationSnapshot = { id: string; label: string; status: OperationStatus; createdAt: number; error?: string };
type Operation = OperationSnapshot & { run?: (signal: AbortSignal) => Promise<void>; controller?: AbortController; gate?: () => Promise<unknown> | null | undefined; releaseWait?: () => void };

/** A page-local serial queue. Each callback owns the inputs captured at enqueue time. */
export class ClientOperationQueue {
  private operations: Operation[] = [];
  private snapshot: OperationSnapshot[] = [];
  private listeners = new Set<() => void>();
  private idleWaiters = new Set<() => void>();
  private pumping = false;
  private sequence = 0;

  constructor(private readonly limit = 10, readonly scope = "") {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("任务队列上限必须为正整数");
  }

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private emit() {
    this.snapshot = this.operations.map(({ id, label, status, createdAt, error }) => ({ id, label, status, createdAt, ...(error ? { error } : {}) }));
    for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot interrupt an operation. */ } }
  }

  private pruneFinished() {
    const finished = this.operations.filter((entry) => !["queued", "running", "cancelling"].includes(entry.status));
    if (finished.length > 30) { const remove = new Set(finished.slice(0, finished.length - 30)); this.operations = this.operations.filter((entry) => !remove.has(entry)); }
  }

  enqueue(label: string, run: (signal: AbortSignal) => Promise<void>, gate?: () => Promise<unknown> | null | undefined): string {
    if (this.operations.filter((item) => ["queued", "running", "cancelling"].includes(item.status)).length >= this.limit) throw new Error(`最多同时安排 ${this.limit} 个任务，请等待或移除排队任务。`);
    const id = `${Date.now()}-${++this.sequence}`;
    this.operations.push({ id, label: label.slice(0, 160), status: "queued", createdAt: Date.now(), run, gate });
    this.emit();
    void this.pump();
    return id;
  }

  cancel(id: string) {
    const item = this.operations.find((entry) => entry.id === id);
    if (!item) return;
    if (item.status === "queued") { item.status = "cancelled"; item.run = undefined; item.gate = undefined; item.releaseWait?.(); item.releaseWait = undefined; }
    else if (item.status === "running") { item.status = "cancelling"; item.controller?.abort(new DOMException("用户取消任务", "AbortError")); }
    this.pruneFinished(); this.emit();
  }

  cancelAll() {
    for (const item of this.operations) {
      if (item.status === "queued") { item.status = "cancelled"; item.run = undefined; item.gate = undefined; item.releaseWait?.(); item.releaseWait = undefined; }
      else if (item.status === "running") { item.status = "cancelling"; item.controller?.abort(new DOMException("任务队列已停止", "AbortError")); }
    }
    this.pruneFinished(); this.emit();
  }

  clearFinished() {
    this.operations = this.operations.filter((item) => ["queued", "running", "cancelling"].includes(item.status));
    this.emit();
  }

  whenIdle(): Promise<void> {
    if (!this.pumping && !this.operations.some((item) => item.status === "queued")) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const item = this.operations.find((entry) => entry.status === "queued");
        if (!item) break;
        try {
          let waited: Promise<unknown> | null | undefined;
          while (item.status === "queued") {
            const blocking = item.gate?.();
            if (!blocking || blocking === waited) break;
            await Promise.race([blocking.then(() => undefined, () => undefined), new Promise<void>((resolve) => { item.releaseWait = resolve; })]);
            item.releaseWait = undefined; waited = blocking;
          }
        } catch (error) {
          item.status = "failed"; item.error = error instanceof Error ? error.message : "等待任务失败";
          item.run = undefined; item.gate = undefined; this.pruneFinished(); this.emit(); continue;
        }
        if (item.status !== "queued") continue;
        const controller = new AbortController();
        item.controller = controller; item.status = "running"; this.emit();
        try {
          await item.run?.(controller.signal);
          item.status = controller.signal.aborted ? "cancelled" : "completed";
        } catch (error) {
          item.status = controller.signal.aborted ? "cancelled" : "failed";
          if (!controller.signal.aborted) item.error = error instanceof Error ? error.message : "任务执行失败";
        } finally {
          item.run = undefined; item.controller = undefined; item.gate = undefined; item.releaseWait = undefined;
          // Retain a bounded result list without retaining image/input closures.
          this.pruneFinished();
          this.emit();
        }
      }
    } finally {
      this.pumping = false;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }
}

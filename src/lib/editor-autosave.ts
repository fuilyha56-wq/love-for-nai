/** One replaceable draft save, with bounded delay and serialized IndexedDB writes. */
export function createEditorAutosave(onError: (error: unknown) => void, delay = 3000, maxWait = 20000) {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let latest: (() => Promise<void>) | undefined;
  let queue = Promise.resolve();

  const flush = (): Promise<void> => {
    clearTimeout(idleTimer);
    clearTimeout(deadlineTimer);
    idleTimer = deadlineTimer = undefined;
    const task = latest;
    latest = undefined;
    if (task) queue = queue.catch(() => undefined).then(task);
    return queue;
  };
  const run = () => { void flush().catch(onError); };
  return {
    schedule(task: () => Promise<void>) {
      latest = task;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(run, delay);
      deadlineTimer ??= setTimeout(run, maxWait);
    },
    flush,
    cancel() {
      clearTimeout(idleTimer);
      clearTimeout(deadlineTimer);
      idleTimer = deadlineTimer = undefined;
      latest = undefined;
    },
  };
}

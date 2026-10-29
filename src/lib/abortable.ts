/** Stop waiting without aborting a shared cache fill used by other requests. */
export function waitWithAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) { void pending.catch(() => undefined); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    pending.then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

/** Log a pending dependency before Vercel's request timeout hides its cause. */
export async function traceSlowOperation<T>(
  phase: string,
  work: () => Promise<T>,
  thresholdMs = 5_000,
): Promise<T> {
  const started = performance.now();
  let warned = false;
  const timer = setTimeout(() => {
    warned = true;
    console.warn(`[slow-operation] ${phase} pending after ${thresholdMs}ms`);
  }, thresholdMs);
  try {
    return await work();
  } finally {
    clearTimeout(timer);
    if (warned)
      console.warn(
        `[slow-operation] ${phase} finished after ${Math.round(performance.now() - started)}ms`,
      );
  }
}

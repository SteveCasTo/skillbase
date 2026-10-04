/** Keep the receipt key after uncertain failures; rotate only for changed payloads. */
export function requestFingerprint(
  values: Readonly<Record<string, string>>,
): string {
  return JSON.stringify(
    Object.entries(values)
      .filter(([name]) => name !== "requestKey" && name !== "confirmed")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
export function createRequestState(
  requestKey: string,
  uuid: () => string,
  initialFingerprint?: string,
) {
  let key = requestKey;
  let fingerprint: string | undefined = initialFingerprint;
  let pending = false;
  return {
    begin(payload: string): string | null {
      if (pending) return null;
      if (fingerprint !== undefined && fingerprint !== payload) key = uuid();
      fingerprint = payload;
      pending = true;
      return key;
    },
    finish() {
      pending = false;
    },
    get pending() {
      return pending;
    },
  };
}
/** Aborting alone is insufficient: adapters may finish after abort. */
export function createLatestSearch<T>() {
  let sequence = 0;
  let controller: AbortController | undefined;
  return {
    async run(
      query: string,
      load: (query: string, signal: AbortSignal) => Promise<T>,
    ): Promise<T | undefined> {
      const token = ++sequence;
      controller?.abort();
      controller = new AbortController();
      const result = await load(query, controller.signal);
      return token === sequence ? result : undefined;
    },
    cancel() {
      ++sequence;
      controller?.abort();
    },
  };
}

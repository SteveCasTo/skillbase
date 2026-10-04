/** Keep the receipt key after uncertain failures; rotate only for changed payloads. */
export function createRequestState(requestKey: string, uuid: () => string) {
  let key = requestKey;
  let fingerprint: string | undefined;
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

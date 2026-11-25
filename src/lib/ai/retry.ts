import { ProviderError } from "./text/types";

/** Retries only errors marked retryable, with capped exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 500, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!(err instanceof ProviderError) || !err.retryable || i === attempts - 1) throw err;
      await sleep(Math.min(baseMs * 2 ** i, 4000));
    }
  }
  throw last;
}

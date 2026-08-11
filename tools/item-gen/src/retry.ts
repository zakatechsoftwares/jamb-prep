/**
 * Retry-with-backoff for the pipeline's external API calls (BUILD point 1).
 * `sleep` is injected — never a bare `setTimeout` — so a test never waits on
 * a real timer, the same clock-injection discipline the rest of this repo
 * holds to.
 */
export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  /** Whether this error is worth retrying at all — a malformed request should fail fast, not retry into a wall. */
  isRetryable: (error: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  let delayMs = options.initialDelayMs;

  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= options.maxAttempts || !options.isRetryable(error)) {
        throw error;
      }
      await options.sleep(delayMs);
      delayMs *= 2;
    }
  }
}

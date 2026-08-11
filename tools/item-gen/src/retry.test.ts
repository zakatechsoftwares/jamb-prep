import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry';

function fakeSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    sleep: async (ms: number) => {
      calls.push(ms);
    },
    calls,
  };
}

describe('withRetry', () => {
  it('returns the result on the first successful attempt without sleeping', async () => {
    const { sleep, calls } = fakeSleep();
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      sleep,
      isRetryable: () => true,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('retries a retryable failure and succeeds once it stops failing', async () => {
    const { sleep, calls } = fakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, {
      maxAttempts: 5,
      initialDelayMs: 10,
      sleep,
      isRetryable: () => true,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    // Exponential backoff: 10, then 20.
    expect(calls).toEqual([10, 20]);
  });

  it('throws once maxAttempts is exhausted', async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 5, sleep, isRetryable: () => true }),
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries an error isRetryable rejects', async () => {
    const { sleep, calls } = fakeSleep();
    const fn = vi.fn().mockRejectedValue(new Error('not worth retrying'));

    await expect(
      withRetry(fn, { maxAttempts: 5, initialDelayMs: 10, sleep, isRetryable: () => false }),
    ).rejects.toThrow('not worth retrying');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });
});

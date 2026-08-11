import { describe, expect, it } from 'vitest';
import type { FetchImpl } from './anthropic-client';
import { callVoyageEmbed, isRetryableVoyageError, VoyageApiError } from './voyage-client';

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(status: number, body: unknown): { fetchImpl: FetchImpl; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      url: String(input),
      method: init?.method,
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

describe('callVoyageEmbed', () => {
  it('posts the model and input texts with a bearer token', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      data: [{ embedding: [0.1, 0.2] }],
      usage: { total_tokens: 12 },
    });

    await callVoyageEmbed(fetchImpl, {
      apiKey: 'voyage-key',
      model: 'voyage-3',
      texts: ['stem text'],
    });

    expect(calls).toEqual([
      {
        url: 'https://api.voyageai.com/v1/embeddings',
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer voyage-key' },
        body: { model: 'voyage-3', input: ['stem text'] },
      },
    ]);
  });

  it('returns embeddings in the same order as the input texts', async () => {
    const { fetchImpl } = fakeFetch(200, {
      data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
      usage: { total_tokens: 20 },
    });

    const result = await callVoyageEmbed(fetchImpl, {
      apiKey: 'voyage-key',
      model: 'voyage-3',
      texts: ['a', 'b'],
    });

    expect(result.embeddings).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(result.usage).toEqual({ totalTokens: 20 });
  });

  it('throws VoyageApiError carrying the status on a non-2xx response', async () => {
    const { fetchImpl } = fakeFetch(401, { error: 'invalid api key' });

    await expect(
      callVoyageEmbed(fetchImpl, { apiKey: 'bad-key', model: 'voyage-3', texts: ['a'] }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('isRetryableVoyageError', () => {
  it('retries 429 and 5xx, not other statuses', () => {
    expect(isRetryableVoyageError(new VoyageApiError(429, {}))).toBe(true);
    expect(isRetryableVoyageError(new VoyageApiError(500, {}))).toBe(true);
    expect(isRetryableVoyageError(new VoyageApiError(401, {}))).toBe(false);
  });

  it('retries a non-API error', () => {
    expect(isRetryableVoyageError(new TypeError('fetch failed'))).toBe(true);
  });
});

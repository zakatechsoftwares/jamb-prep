import { describe, expect, it } from 'vitest';
import {
  AnthropicApiError,
  callAnthropic,
  isRetryableAnthropicError,
  type FetchImpl,
} from './anthropic-client';

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

describe('callAnthropic', () => {
  it('posts the model, system prompt, messages and max_tokens with the required headers', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await callAnthropic(fetchImpl, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      system: 'You are a teacher.',
      messages: [{ role: 'user', content: 'Write an item.' }],
      maxTokens: 4096,
    });

    expect(calls).toEqual([
      {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'sk-test',
          'anthropic-version': '2023-06-01',
        },
        body: {
          model: 'claude-sonnet-5',
          system: 'You are a teacher.',
          messages: [{ role: 'user', content: 'Write an item.' }],
          max_tokens: 4096,
        },
      },
    ]);
  });

  it('extracts the text content and token usage from a successful response', async () => {
    const { fetchImpl } = fakeFetch(200, {
      content: [{ type: 'text', text: '[{"stem": "..."}]' }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const result = await callAnthropic(fetchImpl, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'go' }],
      maxTokens: 100,
    });

    expect(result.text).toBe('[{"stem": "..."}]');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 200 });
  });

  it('throws AnthropicApiError carrying the status and body on a non-2xx response', async () => {
    const { fetchImpl } = fakeFetch(429, {
      error: { type: 'rate_limit_error', message: 'slow down' },
    });

    await expect(
      callAnthropic(fetchImpl, {
        apiKey: 'sk-test',
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'go' }],
        maxTokens: 100,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('isRetryableAnthropicError', () => {
  it('retries 429 and 5xx', () => {
    expect(isRetryableAnthropicError(new AnthropicApiError(429, {}))).toBe(true);
    expect(isRetryableAnthropicError(new AnthropicApiError(500, {}))).toBe(true);
    expect(isRetryableAnthropicError(new AnthropicApiError(503, {}))).toBe(true);
  });

  it('does not retry 400/401/404', () => {
    expect(isRetryableAnthropicError(new AnthropicApiError(400, {}))).toBe(false);
    expect(isRetryableAnthropicError(new AnthropicApiError(401, {}))).toBe(false);
    expect(isRetryableAnthropicError(new AnthropicApiError(404, {}))).toBe(false);
  });

  it('retries a non-API error (network failure)', () => {
    expect(isRetryableAnthropicError(new TypeError('fetch failed'))).toBe(true);
  });
});

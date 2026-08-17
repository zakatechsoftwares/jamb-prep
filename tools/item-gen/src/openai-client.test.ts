import { describe, expect, it } from 'vitest';
import { callOpenAi, isRetryableOpenAiError, OpenAiApiError, type FetchImpl } from './openai-client';

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

describe('callOpenAi', () => {
  it('posts the model, messages and max_tokens with the required headers', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await callOpenAi(fetchImpl, {
      apiKey: 'sk-test',
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'Write an item.' }],
      maxTokens: 4096,
    });

    expect(calls).toEqual([
      {
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer sk-test',
        },
        body: {
          model: 'gpt-4.1',
          messages: [{ role: 'user', content: 'Write an item.' }],
          max_tokens: 4096,
        },
      },
    ]);
  });

  it('prepends a system input as a system-role message, since OpenAI has no separate top-level system field', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await callOpenAi(fetchImpl, {
      apiKey: 'sk-test',
      model: 'gpt-4.1',
      system: 'You are a teacher.',
      messages: [{ role: 'user', content: 'Write an item.' }],
      maxTokens: 4096,
    });

    expect(calls[0]?.body).toMatchObject({
      messages: [
        { role: 'system', content: 'You are a teacher.' },
        { role: 'user', content: 'Write an item.' },
      ],
    });
  });

  it('extracts the text content and token usage from a successful response', async () => {
    const { fetchImpl } = fakeFetch(200, {
      choices: [{ message: { content: '[{"stem": "..."}]' } }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    });

    const result = await callOpenAi(fetchImpl, {
      apiKey: 'sk-test',
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'go' }],
      maxTokens: 100,
    });

    expect(result.text).toBe('[{"stem": "..."}]');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 200 });
  });

  it('throws OpenAiApiError carrying the status and body on a non-2xx response', async () => {
    const { fetchImpl } = fakeFetch(429, {
      error: { type: 'rate_limit_error', message: 'slow down' },
    });

    await expect(
      callOpenAi(fetchImpl, {
        apiKey: 'sk-test',
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'go' }],
        maxTokens: 100,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('isRetryableOpenAiError', () => {
  it('retries 429 and 5xx', () => {
    expect(isRetryableOpenAiError(new OpenAiApiError(429, {}))).toBe(true);
    expect(isRetryableOpenAiError(new OpenAiApiError(500, {}))).toBe(true);
    expect(isRetryableOpenAiError(new OpenAiApiError(503, {}))).toBe(true);
  });

  it('does not retry 400/401/404', () => {
    expect(isRetryableOpenAiError(new OpenAiApiError(400, {}))).toBe(false);
    expect(isRetryableOpenAiError(new OpenAiApiError(401, {}))).toBe(false);
    expect(isRetryableOpenAiError(new OpenAiApiError(404, {}))).toBe(false);
  });

  it('retries a non-API error (network failure)', () => {
    expect(isRetryableOpenAiError(new TypeError('fetch failed'))).toBe(true);
  });
});

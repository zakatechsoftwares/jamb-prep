import type { FetchImpl } from './fetch-types';

export type { FetchImpl };

/**
 * A thin `fetch` wrapper over OpenAI's Chat Completions API — no SDK
 * dependency, matching this repo's existing precedent of reaching for
 * Node's built-ins over a new package where a single HTTP call suffices
 * (see CLAUDE.md's note on session-tokens.ts/password-hashing.ts). `fetchImpl`
 * is injected so every call site here is testable against a fake, network-free
 * implementation, the same discipline `apps/admin/api-client.ts` uses.
 *
 * Replaces `anthropic-client.ts` (this repo's original provider, session 10)
 * — switched because Anthropic's billing didn't accept the available payment
 * method. `system` is a caller-facing input for parity with that module's
 * shape, even though no current call site in `run-generation.ts` passes one:
 * OpenAI's Chat Completions API has no separate top-level `system` field the
 * way Anthropic's Messages API does, so a `system` input is prepended here as
 * a `{role: 'system'}` message instead.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export class OpenAiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`OpenAI API request failed with status ${status}`);
    this.name = 'OpenAiApiError';
  }
}

export interface OpenAiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OpenAiCallInput {
  apiKey: string;
  model: string;
  system?: string;
  messages: OpenAiMessage[];
  maxTokens: number;
}

export interface OpenAiCallResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The full parsed response body, for the raw-response audit log. */
  rawResponse: unknown;
}

export async function callOpenAi(
  fetchImpl: FetchImpl,
  input: OpenAiCallInput,
): Promise<OpenAiCallResult> {
  const messages = input.system
    ? [{ role: 'system' as const, content: input.system }, ...input.messages]
    : input.messages;

  const response = await fetchImpl(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages,
      max_tokens: input.maxTokens,
    }),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new OpenAiApiError(response.status, body);
  }

  const choices = body.choices as { message?: { content?: string } }[] | undefined;
  const text = choices?.[0]?.message?.content ?? '';
  const usage = body.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  return {
    text,
    usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
    rawResponse: body,
  };
}

/** 429 (rate limited) and 5xx are worth retrying; every other status means the request itself is wrong. */
export function isRetryableOpenAiError(error: unknown): boolean {
  if (error instanceof OpenAiApiError) {
    return error.status === 429 || error.status >= 500;
  }
  // A thrown, non-API error (fetch itself rejecting) is a network-level failure — retry it.
  return true;
}

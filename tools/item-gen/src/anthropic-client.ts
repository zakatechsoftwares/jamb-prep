/**
 * A thin `fetch` wrapper over the Anthropic Messages API — no SDK
 * dependency, matching this repo's existing precedent of reaching for
 * Node's built-ins over a new package where a single HTTP call suffices
 * (see CLAUDE.md's note on session-tokens.ts/password-hashing.ts). `fetchImpl`
 * is injected so every call site here is testable against a fake, network-free
 * implementation, the same discipline `apps/admin/api-client.ts` uses.
 */
export type FetchImpl = typeof fetch;

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Anthropic API request failed with status ${status}`);
    this.name = 'AnthropicApiError';
  }
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicCallInput {
  apiKey: string;
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  maxTokens: number;
}

export interface AnthropicCallResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The full parsed response body, for the raw-response audit log. */
  rawResponse: unknown;
}

export async function callAnthropic(
  fetchImpl: FetchImpl,
  input: AnthropicCallInput,
): Promise<AnthropicCallResult> {
  const response = await fetchImpl(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: input.model,
      system: input.system,
      messages: input.messages,
      max_tokens: input.maxTokens,
    }),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new AnthropicApiError(response.status, body);
  }

  const content = body.content as { type: string; text?: string }[] | undefined;
  const text = content?.find((block) => block.type === 'text')?.text ?? '';
  const usage = body.usage as { input_tokens?: number; output_tokens?: number } | undefined;

  return {
    text,
    usage: { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 },
    rawResponse: body,
  };
}

/** 429 (rate limited) and 5xx are worth retrying; every other status means the request itself is wrong. */
export function isRetryableAnthropicError(error: unknown): boolean {
  if (error instanceof AnthropicApiError) {
    return error.status === 429 || error.status >= 500;
  }
  // A thrown, non-API error (fetch itself rejecting) is a network-level failure — retry it.
  return true;
}

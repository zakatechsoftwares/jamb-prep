/**
 * A thin `fetch` wrapper over Voyage AI's embeddings API — kept as its own
 * vendor, independent of whichever provider `openai-client.ts` calls for
 * text generation (neither Anthropic nor OpenAI has an embeddings endpoint
 * bundled with this pipeline's chosen text-generation model). Same
 * injected-`fetchImpl` shape as `openai-client.ts`.
 */
import type { FetchImpl } from './fetch-types';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

export class VoyageApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Voyage API request failed with status ${status}`);
    this.name = 'VoyageApiError';
  }
}

export interface VoyageEmbedInput {
  apiKey: string;
  model: string;
  texts: string[];
}

export interface VoyageEmbedResult {
  /** In the same order as `texts`. */
  embeddings: number[][];
  usage: { totalTokens: number };
  rawResponse: unknown;
}

export async function callVoyageEmbed(
  fetchImpl: FetchImpl,
  input: VoyageEmbedInput,
): Promise<VoyageEmbedResult> {
  const response = await fetchImpl(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({ model: input.model, input: input.texts }),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new VoyageApiError(response.status, body);
  }

  const data = body.data as { embedding: number[] }[] | undefined;
  const usage = body.usage as { total_tokens?: number } | undefined;

  return {
    embeddings: (data ?? []).map((entry) => entry.embedding),
    usage: { totalTokens: usage?.total_tokens ?? 0 },
    rawResponse: body,
  };
}

export function isRetryableVoyageError(error: unknown): boolean {
  if (error instanceof VoyageApiError) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

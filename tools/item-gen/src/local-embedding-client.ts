/**
 * Replaces `voyage-client.ts`'s role in the pipeline: turns an item's stem
 * into an embedding vector for the duplicate-detection gate
 * (`cosineSimilarity`, `item-gen-gates.ts`) — now computed locally via
 * `@huggingface/transformers` (ONNX runtime, CPU, no API key, no
 * per-token cost) instead of a Voyage API call.
 *
 * Confirmed empirically on this machine before writing this: a loaded
 * `pipeline('feature-extraction', model)` extractor, called with
 * `{ pooling: 'mean', normalize: true }`, returns a tensor-like object
 * whose `.tolist()` gives a plain `number[][]` (one 384-dim vector per
 * input text for the default model) — exactly the shape
 * `loadLiveBankEmbeddings`/`cosineSimilarity` already expect.
 *
 * `loadLocalEmbedder` loads the model once per process (real, expensive —
 * `cli.ts`'s `main()` calls it once, not per item) and is the only piece
 * not covered by a unit test, matching `cli-exec.ts`'s `realRunCli` and
 * `openai-client.ts`'s own `fetch` dependency. `createLocalEmbedder` takes
 * an already-loaded extractor function and is what the tests exercise.
 */

export interface LocalEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** The narrow slice of a `@huggingface/transformers` feature-extraction pipeline this module actually uses. */
export type FeatureExtractionFn = (
  texts: string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ tolist(): number[][] }>;

export function createLocalEmbedder(extractor: FeatureExtractionFn): LocalEmbedder {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      return output.tolist();
    },
  };
}

export async function loadLocalEmbedder(modelName: string): Promise<LocalEmbedder> {
  const { pipeline } = await import('@huggingface/transformers');
  const extractor = (await pipeline('feature-extraction', modelName)) as unknown as FeatureExtractionFn;
  return createLocalEmbedder(extractor);
}

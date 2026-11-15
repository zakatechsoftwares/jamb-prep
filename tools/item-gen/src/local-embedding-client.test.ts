import { describe, expect, it } from 'vitest';
import { createLocalEmbedder, type FeatureExtractionFn } from './local-embedding-client';

function fakeExtractor(vectorsByText: Record<string, number[]>): {
  extractor: FeatureExtractionFn;
  calls: { texts: string[]; options: unknown }[];
} {
  const calls: { texts: string[]; options: unknown }[] = [];
  const extractor: FeatureExtractionFn = async (texts, options) => {
    calls.push({ texts, options });
    const vectors = texts.map((text) => vectorsByText[text] ?? []);
    return { tolist: () => vectors };
  };
  return { extractor, calls };
}

describe('createLocalEmbedder', () => {
  it('calls the extractor with mean pooling and normalization', async () => {
    const { extractor, calls } = fakeExtractor({ hello: [0.1, 0.2] });
    const embedder = createLocalEmbedder(extractor);

    await embedder.embed(['hello']);

    expect(calls).toEqual([{ texts: ['hello'], options: { pooling: 'mean', normalize: true } }]);
  });

  it('returns the extractor output converted to a plain number[][]', async () => {
    const { extractor } = fakeExtractor({ a: [1, 2, 3], b: [4, 5, 6] });
    const embedder = createLocalEmbedder(extractor);

    const result = await embedder.embed(['a', 'b']);

    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('preserves input order even when texts repeat', async () => {
    const { extractor } = fakeExtractor({ x: [9] });
    const embedder = createLocalEmbedder(extractor);

    const result = await embedder.embed(['x', 'x']);

    expect(result).toEqual([[9], [9]]);
  });
});

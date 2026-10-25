import { DEFAULT_EMBEDDING, docText, embedAll, type EmbedModel, type Extractor } from '../rag/embedding.ts';
import type { Chunk } from '../rag/types.ts';

export type EmbedChunks = (chunks: Chunk[]) => Promise<Float32Array[]>;

/** Embeds chunks in Node with the same code path the widget uses for queries. */
export async function nodeEmbedder(model: EmbedModel = DEFAULT_EMBEDDING): Promise<EmbedChunks> {
  let transformers: typeof import('@huggingface/transformers');
  try {
    transformers = await import('@huggingface/transformers');
  } catch {
    throw new Error('embedding needs @huggingface/transformers (npm i @huggingface/transformers), or pass --no-embed');
  }
  const extractor = (await transformers.pipeline('feature-extraction', model.id, { dtype: model.dtype as never })) as unknown as Extractor;
  return (chunks) => embedAll(extractor, model, chunks.map(docText));
}

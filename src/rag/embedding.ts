// The one embedding code path, shared by the CLI (Node) and the widget's
// lazily loaded runtime (browser), so query and document vectors always
// match (SPEC §3).
import type { Chunk } from './types.ts';

export interface EmbedModel {
  id: string;
  label: string;
  licence: string;
  dim: number;
  pooling: 'mean' | 'cls';
  /** Prepended to queries (not documents), as the model card asks. */
  queryPrefix: string;
  dtype: string;
  sizeMB: number;
}

export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/** Chosen 2026-10-25 by the spike (SPEC §3). */
export const DEFAULT_EMBEDDING: EmbedModel = {
  id: 'Xenova/bge-small-en-v1.5',
  label: 'bge-small-en-v1.5',
  licence: 'MIT',
  dim: 384,
  pooling: 'cls',
  queryPrefix: BGE_QUERY_PREFIX,
  dtype: 'q8',
  sizeMB: 34,
};

/** The minimal slice of a transformers.js feature-extraction pipeline we use. */
export type Extractor = (texts: string[], opts: { pooling: 'mean' | 'cls'; normalize: boolean }) => Promise<{ data: ArrayLike<number>; dims: number[] }>;

export function docText(chunk: Chunk): string {
  return `${chunk.path.join(' > ')}\n${chunk.text}`;
}

export function queryText(model: EmbedModel, question: string): string {
  return model.queryPrefix + question;
}

export async function embedAll(extractor: Extractor, model: EmbedModel, texts: string[], batch = 8): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += batch) {
    const t = await extractor(texts.slice(i, i + batch), { pooling: model.pooling, normalize: true });
    const dim = t.dims.at(-1)!;
    const data = Float32Array.from(t.data);
    for (let r = 0; r < data.length / dim; r++) out.push(data.slice(r * dim, (r + 1) * dim));
  }
  return out;
}

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
  /** Search tuning for this model's score scale: the vector share of the mix, and the relevance cutoff. */
  vectorWeight: number;
  minScore: number;
  /** Cosine similarity from which a message counts as paraphrased small talk. */
  smallTalk: number;
}

export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/**
 * Chosen 2026-10-25 by the spike (SPEC §3). Search tuning from a labelled
 * eval (2026-10-31) on two sites, deskpal's technical docs and a product's
 * marketing pages: 0.8 vector + 0.2 keyword ranked a right section in the
 * top 4 as often as any mix (89% on both) and kept the widest gap between
 * real and off-topic scores; a 0.50 cutoff caught every off-topic question
 * on the product site and all but one borderline case on the docs.
 * Paraphrased small talk scored 0.76–0.87, doc questions at most 0.74.
 */
export const DEFAULT_EMBEDDING: EmbedModel = {
  id: 'Xenova/bge-small-en-v1.5',
  label: 'bge-small-en-v1.5',
  licence: 'MIT',
  dim: 384,
  pooling: 'cls',
  queryPrefix: BGE_QUERY_PREFIX,
  dtype: 'q8',
  sizeMB: 34,
  vectorWeight: 0.8,
  minScore: 0.5,
  smallTalk: 0.75,
};

/**
 * Three times the download and the time per question, for better ranking:
 * in the same eval, a right section in the top 4 for 97% and 100% of
 * questions. Its scores run lower, so it has its own tuning. Best where
 * questions are embedded on the site's server (`embedEndpoint`), which
 * costs visitors nothing.
 */
export const BGE_BASE: EmbedModel = {
  id: 'Xenova/bge-base-en-v1.5',
  label: 'bge-base-en-v1.5',
  licence: 'MIT',
  dim: 768,
  pooling: 'cls',
  queryPrefix: BGE_QUERY_PREFIX,
  dtype: 'q8',
  sizeMB: 110,
  vectorWeight: 0.9,
  minScore: 0.475,
  // Paraphrased small talk 0.69 and up (but "ok that is everything" 0.65), doc questions at most 0.62.
  smallTalk: 0.68,
};

/** The models an index can be built with, by label. */
export const EMBEDDINGS: readonly EmbedModel[] = [DEFAULT_EMBEDDING, BGE_BASE];

/** The known model an index was built with, if any. */
export function embeddingFor(model: { id: string; dim: number } | null | undefined): EmbedModel | null {
  return EMBEDDINGS.find((m) => m.id === model?.id && m.dim === model.dim) ?? null;
}

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

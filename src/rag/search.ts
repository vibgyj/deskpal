import { DEFAULT_EMBEDDING } from './embedding.ts';
import { KeywordIndex } from './keyword.ts';
import { dequantizeInt8, dot, normalize } from './quantize.ts';
import type { DeskpalIndex, Embedder, Hit } from './types.ts';

export interface SearchOptions {
  topK: number;
  /** Hits scoring below this are dropped. */
  minScore: number;
  /** Weight of the vector score when vectors are in use; the rest is keyword. */
  vectorWeight: number;
}

/** The default model's tuning (see `DEFAULT_EMBEDDING`); other models bring their own. */
export const defaultSearchOptions: SearchOptions = { topK: 4, minScore: 0.3, vectorWeight: DEFAULT_EMBEDDING.vectorWeight };

/** Relevance cutoffs (SPEC §3). With vectors it depends on the model: see `EmbedModel.minScore`. */
export const MIN_SCORE_VECTOR = DEFAULT_EMBEDDING.minScore;
export const MIN_SCORE_KEYWORD = 0.3;

export class IndexModelMismatch extends Error {
  constructor(indexModel: string, embedderModel: string) {
    super(
      `deskpal: the index was built with "${indexModel}" but the widget embeds with ` +
        `"${embedderModel}". Rebuild the index with the same model.`,
    );
  }
}

export class Searcher {
  private keyword: KeywordIndex;
  private vectors: Float32Array[] | null = null;
  readonly index: DeskpalIndex;
  private embedder: Embedder | null;

  constructor(index: DeskpalIndex, embedder: Embedder | null = null) {
    this.index = index;
    this.embedder = embedder;
    this.keyword = new KeywordIndex(index.chunks.map((c) => `${c.title} ${c.path.join(' ')} ${c.text}`));
    if (index.model && embedder) {
      if (index.model.id !== embedder.id || index.model.dim !== embedder.dim) {
        throw new IndexModelMismatch(index.model.id, embedder.id);
      }
      this.vectors = index.chunks.map((c) => (c.v && c.s ? normalize(dequantizeInt8(c.v, c.s)) : new Float32Array(index.model!.dim)));
    }
  }

  get usesVectors(): boolean {
    return this.vectors !== null;
  }

  async search(query: string, options: Partial<SearchOptions> = {}): Promise<Hit[]> {
    const { topK, minScore, vectorWeight } = { ...defaultSearchOptions, ...options };
    const kw = this.keyword.score(query);
    let vec: number[] | null = null;
    if (this.vectors && this.embedder) {
      const qn = normalize(await this.embedder.embedQuery(query));
      vec = this.vectors.map((v) => Math.max(0, dot(qn, v)));
    }
    const hits: Hit[] = this.index.chunks.map((chunk, i) => {
      const keyword = kw[i]!;
      const vector = vec ? vec[i]! : null;
      const score = vector === null ? keyword : vectorWeight * vector + (1 - vectorWeight) * keyword;
      return { chunk, score, keyword, vector };
    });
    return hits
      .filter((h) => h.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

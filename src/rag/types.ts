/** A piece of documentation, split at a heading and capped in size. */
export interface Chunk {
  id: string;
  /** Page title. */
  title: string;
  /** Headings from the page title down to this chunk's own heading. */
  path: string[];
  url: string;
  text: string;
}

export interface IndexChunk extends Chunk {
  /** Embedding as base64 int8, present when the index was built with a model. */
  v?: string;
  /** Scale that turns the int8 values back into floats. */
  s?: number;
}

export interface IndexModel {
  id: string;
  dim: number;
  quant: 'int8';
}

export interface DeskpalIndex {
  format: 'deskpal-index';
  version: 1;
  /** Null for a keyword-only index. */
  model: IndexModel | null;
  chunks: IndexChunk[];
}

export interface Embedder {
  /** Model id; must equal the index's `model.id` for vectors to be used. */
  readonly id: string;
  readonly dim: number;
  /** Embeds a question, applying whatever query prefix the model needs. */
  embedQuery(question: string): Promise<Float32Array>;
  /** Several at once, where that saves round trips (a server embedder). */
  embedQueries?(questions: string[]): Promise<Float32Array[]>;
}

export interface Hit {
  chunk: Chunk;
  /** Combined relevance in [0, 1]. */
  score: number;
  keyword: number;
  vector: number | null;
}

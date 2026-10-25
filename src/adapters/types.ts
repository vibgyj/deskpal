import type { Extract } from '../rag/extract.ts';
import type { Prompt } from '../rag/prompt.ts';

export type ModelAdapter = ExtractiveAdapter | GenerativeAdapter;

/** Picks the answer out of the docs (SPEC §4). */
export interface ExtractiveAdapter {
  kind: 'extract';
  ready(onProgress?: (p: number) => void): Promise<void>;
  /** Best answer span across the passages, or null below the confidence floor. */
  extract(question: string, passages: string[], signal: AbortSignal): Promise<Extract | null>;
}

/** Writes the answer from the retrieved docs (SPEC §4). */
export interface GenerativeAdapter {
  kind: 'generate';
  /** Load whatever the model needs. Reports progress in [0, 1] when it can. */
  ready(onProgress?: (p: number) => void): Promise<void>;
  generate(prompt: Prompt, signal: AbortSignal): AsyncIterable<string>;
}

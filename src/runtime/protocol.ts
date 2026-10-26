// Messages between the widget and deskpal-worker.js.
import type { EmbedModel } from '../rag/embedding.ts';
import type { ExtractModel } from '../rag/extract.ts';
import type { RuntimeOptions } from './index.ts';

export type WorkerRequest = { id: number } & (
  | { op: 'configure'; options: RuntimeOptions }
  | { op: 'loadEmbedder'; model: EmbedModel }
  | { op: 'loadExtractive'; model: ExtractModel; minScore: number }
  | { op: 'embed'; text: string }
  | { op: 'extract'; question: string; passages: string[] }
);

export type WorkerResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string }
  /** Download progress for one model file: [key, loaded, total]. */
  | { id: number; progress: [string, number, number] };

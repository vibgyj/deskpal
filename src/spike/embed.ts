// Embedding candidates compared by the spike. The code path itself lives in
// src/rag/embedding.ts, shared with the CLI and the widget.
import { BGE_QUERY_PREFIX, DEFAULT_EMBEDDING, type EmbedModel } from '../rag/embedding.ts';

export { docText, embedAll, queryText, type EmbedModel, type Extractor } from '../rag/embedding.ts';

export const EMBED_MODELS: EmbedModel[] = [
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'all-MiniLM-L6-v2', licence: 'Apache-2.0', dim: 384, pooling: 'mean', queryPrefix: '', dtype: 'q8', sizeMB: 23 },
  { id: 'Snowflake/snowflake-arctic-embed-xs', label: 'arctic-embed-xs', licence: 'Apache-2.0', dim: 384, pooling: 'cls', queryPrefix: BGE_QUERY_PREFIX, dtype: 'q8', sizeMB: 23 },
  DEFAULT_EMBEDDING,
];

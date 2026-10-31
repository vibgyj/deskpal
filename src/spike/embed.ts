// Embedding candidates compared by the spike. The code path itself lives in
// src/rag/embedding.ts, shared with the CLI and the widget.
import { BGE_QUERY_PREFIX, DEFAULT_EMBEDDING, type EmbedModel } from '../rag/embedding.ts';

export { docText, embedAll, queryText, type EmbedModel, type Extractor } from '../rag/embedding.ts';

// Untuned candidates borrow the default's search tuning.
const TUNING = { vectorWeight: DEFAULT_EMBEDDING.vectorWeight, minScore: DEFAULT_EMBEDDING.minScore, smallTalk: DEFAULT_EMBEDDING.smallTalk };

export const EMBED_MODELS: EmbedModel[] = [
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'all-MiniLM-L6-v2', licence: 'Apache-2.0', dim: 384, pooling: 'mean', queryPrefix: '', dtype: 'q8', sizeMB: 23, ...TUNING },
  { id: 'Snowflake/snowflake-arctic-embed-xs', label: 'arctic-embed-xs', licence: 'Apache-2.0', dim: 384, pooling: 'cls', queryPrefix: BGE_QUERY_PREFIX, dtype: 'q8', sizeMB: 23, ...TUNING },
  DEFAULT_EMBEDDING,
];

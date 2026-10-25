import type { DeskpalConfig } from '../core/config.ts';
import { OpenAICompatibleAdapter } from './openai-compatible.ts';
import type { GenerativeAdapter } from './types.ts';

export type { ExtractiveAdapter, GenerativeAdapter, ModelAdapter } from './types.ts';

/**
 * The generative adapter, if one is configured. The default `browser` adapter
 * is extractive and comes from the lazily loaded runtime instead
 * (runtime-loader.ts); `none` answers from snippets.
 */
export function createGenerativeAdapter(config: DeskpalConfig): GenerativeAdapter | null {
  if (config.adapter !== 'openai-compatible') return null;
  if (!config.endpoint) {
    console.warn('deskpal: adapter "openai-compatible" needs an endpoint; answering from snippets only.');
    return null;
  }
  return new OpenAICompatibleAdapter({ endpoint: config.endpoint, model: config.model ?? 'default', apiKey: config.apiKey });
}

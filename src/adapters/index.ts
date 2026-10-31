import type { DeskpalConfig } from '../core/config.ts';
import { AnthropicAdapter } from './anthropic.ts';
import { CustomAdapter } from './custom.ts';
import { OpenAICompatibleAdapter } from './openai-compatible.ts';
import type { GenerativeAdapter } from './types.ts';

export type { ExtractiveAdapter, GenerativeAdapter, ModelAdapter } from './types.ts';

/**
 * The writer (SPEC §4, tier 2), if one is configured. The default `browser`
 * adapter is extractive, and `browser-generative` runs a writer on the device;
 * both and comes from the lazily loaded runtime instead
 * (runtime-loader.ts); `none` answers from snippets. A misconfigured writer
 * warns and answers from snippets rather than breaking the widget.
 */
export function createGenerativeAdapter(config: DeskpalConfig): GenerativeAdapter | null {
  switch (config.adapter) {
    case 'openai-compatible':
      if (!config.endpoint) return missing('openai-compatible', 'an endpoint');
      return new OpenAICompatibleAdapter({ endpoint: config.endpoint, model: config.model ?? 'default', apiKey: config.apiKey });
    case 'anthropic':
      if (!config.endpoint) return missing('anthropic', 'an endpoint (your proxy to the Claude API)');
      if (config.apiKey) console.warn('deskpal: adapter "anthropic" ignores apiKey; your proxy adds the key on the server.');
      return new AnthropicAdapter({ endpoint: config.endpoint, model: config.model });
    case 'custom':
      if (!config.generate) return missing('custom', 'a generate function passed to init()');
      return new CustomAdapter(config.generate);
    default:
      return null;
  }
}

function missing(adapter: string, what: string): null {
  console.warn(`deskpal: adapter "${adapter}" needs ${what}; answering from snippets only.`);
  return null;
}

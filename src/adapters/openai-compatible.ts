import type { Prompt } from '../rag/prompt.ts';
import { sseData } from './sse.ts';
import type { GenerativeAdapter } from './types.ts';

export interface OpenAICompatibleOptions {
  /** Base URL such as `http://localhost:11434/v1`, or the full chat/completions URL. */
  endpoint: string;
  model: string;
  /** Sent as a bearer token. Only for local or proxied endpoints: it is visible to visitors. */
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export class OpenAICompatibleAdapter implements GenerativeAdapter {
  readonly kind = 'generate';
  private url: string;
  private options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.options = options;
    const e = options.endpoint.replace(/\/+$/, '');
    this.url = e.endsWith('/chat/completions') ? e : `${e}/chat/completions`;
  }

  async ready(): Promise<void> {}

  async *generate(prompt: Prompt, signal: AbortSignal): AsyncIterable<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: this.options.model,
        messages: prompt.messages,
        stream: true,
        temperature: this.options.temperature ?? 0.2,
        max_tokens: this.options.maxTokens ?? 300,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`deskpal: model endpoint answered ${res.status}`);
    for await (const data of sseData(res.body)) {
      if (data === '[DONE]') return;
      let delta: string | undefined;
      try {
        delta = JSON.parse(data).choices?.[0]?.delta?.content;
      } catch {
        continue;
      }
      if (delta) yield delta;
    }
  }
}

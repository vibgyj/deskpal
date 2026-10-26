import type { Prompt } from '../rag/prompt.ts';
import { sseData } from './sse.ts';
import type { GenerativeAdapter } from './types.ts';

/**
 * The Claude Messages API, streamed (SPEC §4). Plain fetch rather than
 * Anthropic's SDK, so the widget keeps zero runtime dependencies. Requests go
 * to the site's own proxy, which adds the API key: a key in the page is
 * readable by every visitor.
 */
export interface AnthropicOptions {
  /** The site's proxy for `POST /v1/messages`: its full URL, or a base ending in `/v1`. */
  endpoint: string;
  /** Default: claude-opus-5-5. */
  model?: string;
  /** Room for the model's thinking as well as the short answer. */
  maxTokens?: number;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_VERSION = '2026-10-21';
/** Server-side refusal fallback: on a policy decline the API retries on another model, in the same stream. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
/** Models that take `output_config.effort`. Answers are a sentence or two from given sources, so `low` is plenty. */
const EFFORT_MODELS = /^claude-(?:(?:fable|mythos|opus|sonnet|haiku)-5|opus-4-[5-8]|sonnet-4-6)/;

/** The model declined; the partial answer, if any, must be discarded. */
export class RefusalError extends Error {
  readonly category: string | null;
  constructor(category: string | null) {
    super(`deskpal: Claude declined to answer${category ? ` (${category})` : ''}`);
    this.name = 'RefusalError';
    this.category = category;
  }
}

interface StreamEvent {
  type: string;
  delta?: { type?: string; text?: string; stop_reason?: string | null; stop_details?: { category?: string | null } | null };
  error?: { type?: string; message?: string };
}

export class AnthropicAdapter implements GenerativeAdapter {
  readonly kind = 'generate';
  private url: string;
  private model: string;
  private maxTokens: number;

  constructor(options: AnthropicOptions) {
    const e = options.endpoint.replace(/\/+$/, '');
    this.url = /\/v1$/.test(e) ? `${e}/messages` : e;
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.maxTokens = options.maxTokens ?? 1024;
  }

  async ready(): Promise<void> {}

  async *generate(prompt: Prompt, signal: AbortSignal): AsyncIterable<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION };
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      stream: true,
      system: prompt.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'),
      messages: prompt.messages.filter((m) => m.role !== 'system'),
    };
    if (EFFORT_MODELS.test(this.model)) body.output_config = { effort: 'low' };
    if (FALLBACK_MODELS.has(this.model)) {
      headers['anthropic-beta'] = FALLBACK_BETA;
      body.fallbacks = 'default';
    }

    const res = await fetch(this.url, { method: 'POST', headers, signal, body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`deskpal: Claude endpoint answered ${res.status}${await errorType(res)}`);
    for await (const data of sseData(res.body)) {
      let event: StreamEvent;
      try {
        event = JSON.parse(data) as StreamEvent;
      } catch {
        continue;
      }
      // Thinking and other block types are skipped: only the answer text is shown.
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) yield event.delta.text;
      else if (event.type === 'message_delta' && event.delta?.stop_reason === 'refusal') throw new RefusalError(event.delta.stop_details?.category ?? null);
      else if (event.type === 'error') throw new Error(`deskpal: Claude stream error: ${event.error?.type ?? 'unknown'}`);
    }
  }
}

/** The API's error type, such as `overloaded_error`, for the console. */
async function errorType(res: Response): Promise<string> {
  try {
    const type = ((await res.json()) as StreamEvent).error?.type;
    return type ? ` (${type})` : '';
  } catch {
    return '';
  }
}

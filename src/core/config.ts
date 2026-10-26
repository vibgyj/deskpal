export type AdapterName = 'browser' | 'openai-compatible' | 'none';
export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface DeskpalConfig {
  /** URL of the prebuilt `deskpal-index.json`. */
  index?: string;
  adapter: AdapterName;
  /** openai-compatible: base URL such as `http://localhost:11434/v1`. */
  endpoint?: string;
  /** openai-compatible: model name sent to the endpoint. */
  model?: string;
  /** openai-compatible: bearer token. Visible to visitors; use only with a proxy or local server. */
  apiKey?: string;
  /** Base URL for self-hosted model files (`{modelHost}/{model id}/...`). Hugging Face when unset. */
  modelHost?: string;
  /** URL of deskpal-runtime.js. Defaults to the same folder as the widget script. */
  runtimeUrl?: string;
  /** URL of a skin manifest. The built-in mascot when unset. */
  skin?: string;
  /** Name shown in the bubble header, and `{name}` in the voice's lines. */
  name: string;
  /** The first line when the bubble opens. A random `greeting` from the voice when unset. */
  greeting?: string;
  /** The persona's lines, line set by line set (SPEC §7). JSON config or init() only. */
  voice?: Record<string, string | string[]>;
  /** Reply to greetings, thanks and the like without searching the docs. */
  smallTalk: boolean;
  /** The one unprompted tip per page view. None when unset. */
  tip?: string;
  /** Milliseconds before the tip appears. */
  tipDelay: number;
  position: Corner;
  /** Pixel scale for the sprite. */
  scale: number;
  topK: number;
  /** Retrieval cutoff, 0–1. Defaults to 0.45 with vectors, 0.3 keyword-only. */
  minScore?: number;
  /** browser: confidence below which the matching sections are shown instead of an extracted answer. */
  minAnswerScore: number;
  /** browser: confidence from which an extracted answer is presented as sure rather than a best guess. */
  sureAnswerScore: number;
  /** browser: run the models in a Web Worker, falling back to the main thread when it can't start. */
  worker: boolean;
  /** Namespace for remembered state. Defaults to the page's host. */
  siteKey: string;
}

export const defaults: DeskpalConfig = {
  adapter: 'browser',
  name: 'deskpal',
  smallTalk: true,
  tipDelay: 20_000,
  position: 'bottom-right',
  scale: 3,
  topK: 4,
  minAnswerScore: 0.1,
  sureAnswerScore: 0.5,
  worker: true,
  siteKey: '',
};

const ADAPTERS: AdapterName[] = ['browser', 'openai-compatible', 'none'];
const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const STRING_KEYS = ['index', 'endpoint', 'model', 'apiKey', 'modelHost', 'runtimeUrl', 'skin', 'name', 'greeting', 'tip', 'siteKey'] as const;
const NUMBER_KEYS = ['tipDelay', 'scale', 'topK', 'minScore', 'minAnswerScore', 'sureAnswerScore'] as const;
const BOOLEAN_KEYS = ['smallTalk', 'worker'] as const;

/**
 * Keeps only known keys with values of the right type, so a typo in a data
 * attribute or JSON block is ignored with a warning instead of breaking boot.
 */
export function sanitize(input: Record<string, unknown>): Partial<DeskpalConfig> {
  const out: Partial<DeskpalConfig> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) continue;
    if ((STRING_KEYS as readonly string[]).includes(key)) {
      (out as Record<string, unknown>)[key] = String(raw);
    } else if ((NUMBER_KEYS as readonly string[]).includes(key)) {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[key] = n;
      else console.warn(`deskpal: ignoring ${key}=${String(raw)} (not a number)`);
    } else if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      // Data attributes arrive as strings: data-small-talk="false".
      if (typeof raw === 'boolean' || raw === 'true' || raw === 'false') (out as Record<string, unknown>)[key] = raw === true || raw === 'true';
      else console.warn(`deskpal: ignoring ${key}=${String(raw)} (not true or false)`);
    } else if (key === 'voice') {
      if (typeof raw === 'object' && !Array.isArray(raw)) out.voice = raw as Record<string, string | string[]>;
      else console.warn('deskpal: voice must be an object of line sets');
    } else if (key === 'adapter') {
      if (ADAPTERS.includes(raw as AdapterName)) out.adapter = raw as AdapterName;
      else console.warn(`deskpal: unknown adapter "${String(raw)}"`);
    } else if (key === 'position') {
      if (CORNERS.includes(raw as Corner)) out.position = raw as Corner;
      else console.warn(`deskpal: unknown position "${String(raw)}"`);
    } else if (key !== 'auto') {
      console.warn(`deskpal: unknown option "${key}"`);
    }
  }
  return out;
}

/** `data-model-host` arrives in `dataset` as `modelHost`, which already matches our keys. */
export function fromDataset(dataset: Record<string, string | undefined>): Partial<DeskpalConfig> {
  return sanitize(dataset);
}

export function fromJson(text: string): Partial<DeskpalConfig> {
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return sanitize(data as Record<string, unknown>);
  } catch {
    // fall through
  }
  console.warn('deskpal: #deskpal-config is not a JSON object; ignoring it');
  return {};
}

export function resolveConfig(...layers: Partial<DeskpalConfig>[]): DeskpalConfig {
  const config: DeskpalConfig = Object.assign({}, defaults, ...layers);
  if (!config.siteKey) config.siteKey = typeof location === 'undefined' ? 'default' : location.host || 'default';
  return config;
}

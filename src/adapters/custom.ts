import type { Prompt } from '../rag/prompt.ts';
import type { GenerativeAdapter } from './types.ts';

/**
 * A writer the site supplies through `init({ adapter: 'custom', generate })`
 * (SPEC §4): any API, the site's own backend and auth. It gets the prompt, the
 * raw question and the matching sections, and returns the answer as a stream
 * of text pieces or all at once.
 */
export type GenerateFn = (prompt: Prompt, signal: AbortSignal) => AsyncIterable<string> | Promise<string> | string;

export class CustomAdapter implements GenerativeAdapter {
  readonly kind = 'generate';
  private fn: GenerateFn;

  constructor(fn: GenerateFn) {
    this.fn = fn;
  }

  async ready(): Promise<void> {}

  async *generate(prompt: Prompt, signal: AbortSignal): AsyncIterable<string> {
    const out = this.fn(prompt, signal);
    if (typeof out === 'object' && out !== null && Symbol.asyncIterator in out) {
      for await (const piece of out) {
        if (signal.aborted) return;
        if (typeof piece === 'string' && piece) yield piece;
      }
      return;
    }
    const text = await out;
    if (typeof text !== 'string') throw new Error('deskpal: the custom generate() must return text, a promise of text, or an async iterable of text');
    if (text) yield text;
  }
}

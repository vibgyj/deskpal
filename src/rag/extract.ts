// Model-free parts of extractive answering: building the context the QA model
// reads, and finding its answer back in the original passages.

export interface ExtractModel {
  id: string;
  dtype: string;
  sizeMB: number;
}

/** Chosen 2026-10-25 (SPEC §4, §11.1, §11.7). English only. */
export const DEFAULT_EXTRACTIVE: ExtractModel = { id: 'Xenova/distilbert-base-cased-distilled-squad', dtype: 'q8', sizeMB: 66 };

export interface Extract {
  /** Index of the passage the answer came from. */
  passage: number;
  answer: string;
  score: number;
  /** Character range of the answer within that passage, when it could be located. */
  start?: number;
  end?: number;
}

const SEPARATOR = '\n\n';

/**
 * Joins passages, best first, into one context within a character budget (the
 * QA model reads ~512 tokens). Passages are what was validated: answering over
 * the joined context scored off-topic questions at 0.
 */
export function joinPassages(passages: string[], budget = 1800): { context: string; offsets: number[] } {
  const offsets: number[] = [];
  let context = '';
  for (const p of passages) {
    const sep = context ? SEPARATOR : '';
    if (context && context.length + sep.length + p.length > budget) break;
    offsets.push(context.length + sep.length);
    context += sep + p.slice(0, budget - context.length - sep.length);
  }
  return { context, offsets };
}

/**
 * Finds `answer` in `text`. The QA pipeline returns the answer re-spaced from
 * its tokens ("build - index" for "build-index"), so whitespace between tokens
 * is optional and case is ignored.
 */
export function locateSpan(text: string, answer: string): { start: number; end: number } | null {
  const tokens = answer.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu);
  if (!tokens) return null;
  const re = new RegExp(tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'iu');
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** Maps an answer over the joined context back to its passage. */
export function toExtract(passages: string[], joined: { context: string; offsets: number[] }, answer: string, score: number): Extract | null {
  const trimmed = answer.trim();
  if (!trimmed) return null;
  const span = locateSpan(joined.context, trimmed);
  if (!span) return { passage: 0, answer: trimmed, score };
  let passage = 0;
  for (let i = 0; i < joined.offsets.length; i++) if (joined.offsets[i]! <= span.start) passage = i;
  const base = joined.offsets[passage]!;
  const end = Math.min(span.end - base, passages[passage]!.length);
  return { passage, answer: passages[passage]!.slice(span.start - base, end), score, start: span.start - base, end };
}

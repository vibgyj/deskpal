import type { Hit } from './types.ts';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A matching doc section, as writers receive it. */
export interface Source {
  title: string;
  url: string;
  text: string;
}

export interface Prompt {
  /** The system message (instructions and numbered sources), then the question. */
  messages: Message[];
  /** The raw question and sections, for writers that build their own prompt. */
  question: string;
  sources: Source[];
}

export const SYSTEM_PROMPT = [
  'You are a friendly help assistant on a website.',
  'Answer the question using ONLY the numbered sources below.',
  'Cite the sources you used like [1] or [2].',
  'If the sources do not answer the question, say "I don\'t know that one" and nothing else.',
  'Answer in one or two sentences, under 50 words.',
].join(' ');

export function buildPrompt(question: string, hits: Hit[], maxSourceChars = 1200): Prompt {
  const sources = hits.map((h) => ({ title: [h.chunk.title, ...h.chunk.path.slice(1)].join(' > '), url: h.chunk.url, text: h.chunk.text.slice(0, maxSourceChars) }));
  const numbered = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.text}`).join('\n\n');
  return {
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nSources:\n\n${numbered}` },
      { role: 'user', content: question },
    ],
    question,
    sources,
  };
}

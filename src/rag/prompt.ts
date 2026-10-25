import type { Hit } from './types.ts';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Prompt {
  messages: Message[];
}

export const SYSTEM_PROMPT = [
  'You are a friendly help assistant on a website.',
  'Answer the question using ONLY the numbered sources below.',
  'Cite the sources you used like [1] or [2].',
  'If the sources do not answer the question, say "I don\'t know that one" and nothing else.',
  'Answer in one or two sentences, under 50 words.',
].join(' ');

export function buildPrompt(question: string, hits: Hit[], maxSourceChars = 1200): Prompt {
  const sources = hits
    .map((h, i) => {
      const heading = [h.chunk.title, ...h.chunk.path.slice(1)].join(' > ');
      return `[${i + 1}] ${heading}\n${h.chunk.text.slice(0, maxSourceChars)}`;
    })
    .join('\n\n');
  return {
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nSources:\n\n${sources}` },
      { role: 'user', content: question },
    ],
  };
}

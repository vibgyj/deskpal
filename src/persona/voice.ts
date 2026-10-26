// The persona's lines (SPEC §7). Built-in defaults, overridden per line set by
// the skin's manifest and then by the site's config.

export const INTENTS = ['hello', 'thanks', 'bye', 'who', 'help', 'howAreYou', 'praise', 'insult', 'joke'] as const;
export type Intent = (typeof INTENTS)[number];

export const LINE_SETS = ['greeting', 'thinking', 'found', 'unsure', 'snippets', 'dontKnow', 'noDocs', 'error', 'nextBest', 'outOfIdeas', ...INTENTS] as const;
export type LineSet = (typeof LINE_SETS)[number];

export type Voice = Record<LineSet, string[]>;

export const DEFAULT_VOICE: Voice = {
  greeting: ['Hi! Ask me anything about this site.', 'Hello there! What can I dig up for you?', 'Hi! I know these docs pretty well. Ask away.'],
  thinking: ['Let me flip through the docs…', 'Hmm, checking my notes…', 'Rummaging through the docs…'],
  found: ['Found it!', 'Here you go!', 'Aha, this one:'],
  unsure: ["I think this is it, but double-check:", 'This looks close:', "Not 100% sure, but here's my best guess:"],
  snippets: ["Here's what the docs say:", 'These sections look relevant:'],
  dontKnow: ["I don't know that one.", "Hmm, I couldn't find that in these docs.", "That one's not in my docs, sorry!"],
  noDocs: ["I haven't been given any docs to read yet, so I can't answer that."],
  error: ["My answer model isn't available right now, so here's what the docs say."],
  nextBest: ['How about this one?', 'Maybe this instead?'],
  outOfIdeas: ["That's all I've got. These might help:"],
  hello: ['Hi there! What would you like to know?', 'Hello! Ask me about this site.', 'Hey! How can I help?'],
  thanks: ['Happy to help!', 'Any time!', "You're welcome!"],
  bye: ['Bye! Click me if you need anything.', 'See you around!'],
  who: ["I'm {name}, a little helper who knows this site's docs. Ask me a question!"],
  help: ["Ask me a question about this site and I'll find the answer in its docs, with a link to the page."],
  howAreYou: ["I'm great, thanks! Sitting here reading the docs. What can I help with?", 'Never better! Got a question for me?'],
  praise: ['Aw, thanks!', 'You just made my day!'],
  insult: ["Sorry! I'm still learning. Try asking another way?", "Ouch. I'll try harder. Can you rephrase that?"],
  joke: [
    'Why did the developer go broke? Because they used up all their cache.',
    "I'd tell you a UDP joke, but you might not get it.",
    'There are 10 kinds of people: those who understand binary, and those who don\'t.',
  ],
};

/**
 * Layers line sets over the defaults. A layer replaces a whole line set, so a
 * translation never mixes in default lines. Bad entries are ignored with a
 * warning, as with the rest of the config.
 */
export function mergeVoice(...layers: (Record<string, unknown> | undefined)[]): Voice {
  const voice: Voice = { ...DEFAULT_VOICE };
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, raw] of Object.entries(layer)) {
      if (!(LINE_SETS as readonly string[]).includes(key)) {
        console.warn(`deskpal: unknown voice line set "${key}"`);
        continue;
      }
      const lines = (typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : []).filter((l): l is string => typeof l === 'string' && l.trim() !== '');
      if (lines.length) voice[key as LineSet] = lines;
      else console.warn(`deskpal: voice "${key}" must be a string or a list of strings`);
    }
  }
  return voice;
}

/** Picks lines at random, never the same line twice in a row for a set. */
export class Speaker {
  private voice: Voice;
  private name: string;
  private random: () => number;
  private last = new Map<LineSet, number>();

  constructor(voice: Voice, name: string, random: () => number = Math.random) {
    this.voice = voice;
    this.name = name;
    this.random = random;
  }

  say(set: LineSet): string {
    const lines = this.voice[set];
    let i = Math.floor(this.random() * lines.length);
    if (lines.length > 1 && i === this.last.get(set)) i = (i + 1) % lines.length;
    this.last.set(set, i);
    return lines[i]!.replaceAll('{name}', this.name);
  }
}

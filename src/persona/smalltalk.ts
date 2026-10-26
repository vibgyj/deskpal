// Small talk (SPEC §7): greetings, thanks and the like get a reply from the
// voice instead of a docs search. Phrase patterns work in every tier; with the
// query embedder loaded, paraphrases are caught by similarity to examples.
import type { Intent } from './voice.ts';

const POLITE = '(?: please| there| again| to you| mate| buddy| pal| friend| lol| haha| :\\))*';
const OK = '(?:(?:ok|okay|oh|great|awesome|perfect|cool|nice|alright|right) )?';
const YOU_ARE = "(?:you're|you are|youre|ur|you r)";

const PATTERNS: Record<Intent, string> = {
  hello: '(?:hi|hello|hey|heya|hiya|howdy|yo|greetings|hi hi|hey hey|good (?:morning|afternoon|evening|day))',
  thanks: `${OK}(?:thanks|thank you|thank u|thx|ty|cheers|sorted|many thanks|much appreciated|appreciate it|that helped|that helps|(?:thanks|thank you) (?:so |very )?much|thanks a lot|thanks a bunch)`,
  bye: `${OK}(?:bye|bye bye|goodbye|good bye|see you|see ya|see you later|cya|later|gotta go|that's all|thats all|i'm done|im done|good night)`,
  who: "(?:who are you|who r u|what are you|who is this|what is your name|what's your name|whats your name|who made you|who built you|are you (?:a |an )?(?:bot|robot|human|person|ai|real))",
  help: '(?:help|help me|what can you do|what do you do|how does this work|how do i use (?:this|you)|what can i ask(?: you)?|what should i ask|how can you help(?: me)?|can you help(?: me)?)',
  howAreYou: "(?:how are you|how r u|how are you doing|how's it going|hows it going|how is it going|what's up|whats up|sup|how do you do)(?: today)?",
  praise: `(?:${YOU_ARE} (?:so |very |really )?(?:great|awesome|amazing|cute|the best|smart|clever|cool|helpful|adorable|brilliant)|good (?:job|bot|work)|nice (?:one|work)|well done|great job|i love you|love you|awesome|amazing|brilliant)`,
  insult: `(?:${YOU_ARE} (?:so |very |really )?(?:useless|stupid|dumb|annoying|bad|terrible|wrong|an idiot|the worst|not helpful)|(?:this is |that's |thats |that is )?(?:useless|stupid|dumb|not helpful|unhelpful)|bad bot|shut up|you suck|this sucks)`,
  joke: '(?:tell me a joke|tell me another joke|tell me another one|tell a joke|another joke|say something funny|make me laugh|make me smile|joke|do you know any jokes|know any jokes|got any jokes)',
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}' :)]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The intent of a message that is only small talk, or null. "hi, how do I
 * install it?" is a question, not a greeting, so the whole message must match.
 * The assistant's name may lead or trail ("thanks deskpal"), but "what is
 * deskpal" stays a docs question.
 */
export function matchSmallTalk(text: string, name = ''): Intent | null {
  const msg = normalize(text);
  if (!msg) return null;
  const n = normalize(name);
  const nameRe = n ? `(?:(?:hey |hi |ok |okay )?${escape(n)},? )?` : '';
  const nameEnd = n ? `(?: ${escape(n)})?` : '';
  for (const [intent, pattern] of Object.entries(PATTERNS) as [Intent, string][]) {
    if (new RegExp(`^${nameRe}${pattern}${nameEnd}${POLITE}$`, 'u').test(msg)) return intent;
  }
  return null;
}

/** The expression for each reply. Optional ones fall back on skins without them (SPEC §5). */
export const INTENT_ANIMATION: Record<Intent, string> = {
  hello: 'wave',
  thanks: 'happy',
  bye: 'wave',
  who: 'happy',
  help: 'pointing',
  howAreYou: 'happy',
  praise: 'blush',
  insult: 'sorry',
  joke: 'laugh',
};

/** Example phrases for similarity matching: paraphrases the patterns miss. */
export const INTENT_EXAMPLES: Record<Intent, string[]> = {
  hello: ['hello', 'hi there', 'hey, nice to meet you'],
  thanks: ['thank you', 'thanks, that solved it', 'great, that was helpful'],
  bye: ['goodbye', "that's all I needed", 'see you later'],
  who: ['who are you?', 'what kind of assistant are you?', 'are you a real person or a bot?'],
  help: ['what can you do?', 'what kind of questions can I ask you?', 'how do I use this assistant?'],
  howAreYou: ['how are you?', 'how is your day going?', 'how are you feeling today?'],
  praise: ["you're awesome", 'you are very helpful', 'good job, little buddy'],
  insult: ["you're useless", 'this assistant is stupid', 'you are not helping at all'],
  joke: ['tell me a joke', 'say something funny', 'do you know any good jokes?'],
};

/**
 * Below this cosine similarity (bge-small) to the nearest example, a message
 * isn't small talk. Calibrated 2026-10-25: paraphrases scored 0.76–0.87 and
 * the demo's doc questions at most 0.74. It is only consulted when the docs
 * matched nothing, so a near miss replaces "I don't know", never an answer.
 */
export const SIMILARITY_THRESHOLD = 0.75;
/** Longer messages are questions, however chatty. */
export const MAX_SMALL_TALK_WORDS = 8;

/** Similarity matching with the query embedder. Example vectors are computed once, on first use. */
export class SmallTalkMatcher {
  private embed: (text: string) => Promise<Float32Array>;
  private examples: Promise<{ intent: Intent; v: Float32Array }[]> | null = null;
  private threshold: number;

  constructor(embed: (text: string) => Promise<Float32Array>, threshold = SIMILARITY_THRESHOLD) {
    this.embed = embed;
    this.threshold = threshold;
  }

  /** The nearest intent and its similarity, whether or not it passes the threshold. */
  async nearest(text: string): Promise<{ intent: Intent; score: number } | null> {
    if (normalize(text).split(' ').length > MAX_SMALL_TALK_WORDS) return null;
    this.examples ??= this.embedExamples();
    const examples = await this.examples;
    const q = await this.embed(text);
    let best: { intent: Intent; score: number } | null = null;
    for (const { intent, v } of examples) {
      let score = 0;
      for (let i = 0; i < v.length; i++) score += v[i]! * q[i]!;
      if (!best || score > best.score) best = { intent, score };
    }
    return best;
  }

  async match(text: string): Promise<Intent | null> {
    const best = await this.nearest(text);
    return best && best.score >= this.threshold ? best.intent : null;
  }

  private async embedExamples(): Promise<{ intent: Intent; v: Float32Array }[]> {
    const out: { intent: Intent; v: Float32Array }[] = [];
    for (const [intent, phrases] of Object.entries(INTENT_EXAMPLES) as [Intent, string[]][]) {
      for (const p of phrases) out.push({ intent, v: await this.embed(p) });
    }
    return out;
  }
}

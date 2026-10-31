import { termGroups } from './text.ts';

const K1 = 1.2;
const B = 0.75;
const PRESENCE = 0.7;

/**
 * BM25-lite over the chunks, scaled so a score is comparable across queries
 * and can gate relevance: each query term contributes its idf share. Presence
 * earns most of that share; term frequency and chunk length (as in BM25)
 * decide the rest. A chunk containing every query term scores at least 0.7.
 */
export class KeywordIndex {
  private docs: Map<string, number>[] = [];
  private lengths: number[] = [];
  private df = new Map<string, number>();
  private avgLength = 1;

  constructor(texts: string[]) {
    for (const text of texts) {
      const tf = new Map<string, number>();
      const words = termGroups(text);
      for (const t of words.flat()) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push(tf);
      this.lengths.push(words.length);
    }
    const total = this.lengths.reduce((a, b) => a + b, 0);
    this.avgLength = Math.max(1, total / Math.max(1, texts.length));
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /**
   * One score per chunk, in index order. Each query word counts once, matched
   * by any of its forms, and weighs as its most common form, since that is
   * what it matches.
   */
  score(query: string): number[] {
    const seen = new Set<string>();
    const q = termGroups(query, true).filter((g) => !seen.has(g[0]!) && seen.add(g[0]!));
    const scores = new Array<number>(this.docs.length).fill(0);
    if (q.length === 0) return scores;
    const weights = q.map((g) => Math.min(...g.map((t) => this.idf(t))));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    for (let d = 0; d < this.docs.length; d++) {
      const tf = this.docs[d]!;
      const norm = K1 * (1 - B + (B * this.lengths[d]!) / this.avgLength);
      let s = 0;
      q.forEach((g, i) => {
        const f = Math.max(0, ...g.map((t) => tf.get(t) ?? 0));
        if (f) s += weights[i]! * (PRESENCE + (1 - PRESENCE) * (f / (f + norm)));
      });
      scores[d] = s / totalWeight;
    }
    return scores;
  }
}

const STOPWORDS = new Set(
  ('a an and are as at be but by can do does for from how i if in into is it its ' +
    'me my of on or so that the their them then there these this to was we what ' +
    'when where which who why will with you your').split(' '),
);

/** Lowercased word tokens. Keeps identifiers like `data-index` and `v1` intact. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu) ?? [];
}

/**
 * Words a visitor uses for what the docs call price: "how much does it cost"
 * against "Pricing". Only questions are widened this way, so a doc's own
 * "fee" or "subscription" keeps its meaning there.
 */
const PRICE = new Set(['cost', 'fee', 'charge', 'expensive', 'cheap', 'cheaper', 'afford', 'affordable', 'subscription', 'subscribe']);

/** Folds plurals so "needs" matches "need". */
export function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/**
 * A word and, for an -ing, -ed or -ly word, the bases it may come from:
 * "pricing" gives price and pric, "embedding" embed, "stopped" stop, "monthly"
 * month. Base words are never cut, so "note" never becomes "not"; a wrong
 * guess such as "booke" is a term no word has. Under four letters is too
 * short to guess at. In a question, the price words also look for "price".
 */
export function forms(word: string, question = false): string[] {
  const t = stem(word);
  const out = [t];
  const base =
    t.length > 5 && t.endsWith('ing') ? t.slice(0, -3)
    : t.length > 4 && t.endsWith('ed') && !t.endsWith('eed') ? t.slice(0, -2)
    : t.length > 5 && t.endsWith('ly') ? t.slice(0, -2)
    : null;
  if (base) {
    for (const b of [base, `${base}e`, /([^aeioulsz])\1$/.test(base) ? base.slice(0, -1) : '']) {
      if (b.length >= 4 && !out.includes(b)) out.push(b);
    }
  }
  if (question && out.some((f) => PRICE.has(f))) out.push('price');
  return out;
}

/**
 * Words worth matching on, each as its forms (see `forms`): no stopwords, no
 * single characters. A compound token also counts as its parts, so "index"
 * finds "data-index".
 */
export function termGroups(text: string, question = false): string[][] {
  const out: string[][] = [];
  for (const t of tokenize(text)) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.push(forms(t, question));
    if (/[-_.]/.test(t)) for (const p of t.split(/[-_.]/)) if (p.length > 1 && !STOPWORDS.has(p)) out.push(forms(p, question));
  }
  return out;
}

/** Every form of every word worth matching on. */
export function terms(text: string): string[] {
  return termGroups(text).flat();
}

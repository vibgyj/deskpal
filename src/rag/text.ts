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
 * Words a visitor uses for the same thing the docs call something else, folded
 * to one term. Only money so far: "how much does it cost" against "Pricing".
 */
const SAME = new Map(['cost', 'costs', 'costing', 'fee', 'fees', 'charge', 'charges', 'charged', 'expensive', 'cheap', 'cheaper', 'afford', 'affordable'].map((w) => [w, 'price']));

/**
 * Folds plurals and -ing/-ed so "needs" matches "need" and "pricing" matches
 * "price". Deliberately timid: a missed match only costs keyword score, since
 * vectors catch meaning.
 */
export function stem(word: string): string {
  let t = SAME.get(word) ?? word;
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed') && !t.endsWith('eed')) t = t.slice(0, -2);
  // booked → book stays, but stopp(ed) → stop and pric(e) → pric.
  if (/([^aeioulsz])\1$/.test(t)) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith('e') && !t.endsWith('ee')) t = t.slice(0, -1);
  return t;
}

/** Tokens worth matching on: no stopwords, no single characters. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(text)) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.push(stem(t));
    // Also index the parts of compound tokens, so "index" finds "data-index".
    if (/[-_.]/.test(t)) for (const p of t.split(/[-_.]/)) if (p.length > 1 && !STOPWORDS.has(p)) out.push(stem(p));
  }
  return out;
}

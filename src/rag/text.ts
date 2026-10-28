const STOPWORDS = new Set(
  ('a an and are as at be but by can do does for from how i if in into is it its ' +
    'me my of on or so that the their them then there these this to was we what ' +
    'when where which who why will with you your').split(' '),
);

/** Lowercased word tokens. Keeps identifiers like `data-index` and `v1` intact. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Folds simple plurals so "needs" matches "need". Deliberately timid. */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
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

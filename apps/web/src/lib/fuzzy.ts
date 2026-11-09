/**
 * Forgiving search for short lists (the command palette). A query matches when its letters appear in order in the text;
 * the score rewards matches at the start of a word, consecutive letters and a short text, so "rt" finds "Realtime" and
 * "Retention" but ranks "Realtime" (word start, shorter) first. Returns null for no match. Case and accents are ignored.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query);
  const t = normalize(text);
  if (q === "") return 0;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi]!;
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const atWordStart = found === 0 || /[\s\-_/&]/.test(t[found - 1]!);
    streak = found === ti && qi > 0 ? streak + 1 : 0;
    score += 1 + (atWordStart ? 6 : 0) + streak * 3 - Math.min(found - ti, 5) * 0.4;
    ti = found + 1;
  }
  // A whole-word or prefix match beats a scattered one.
  if (t.startsWith(q)) score += 12;
  return score - t.length * 0.05;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Items that match, best first. Items with the same score keep their original order. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (query.trim() === "") return [...items];
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}

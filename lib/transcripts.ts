export interface TranscriptMatch {
  id: string;
  snippet: string;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from have how i if in into is it its me my of on or our " +
    "so that the their them then there these they this to us was we what when where which who why will " +
    "with you your about any anything something some just like want need help teach teaching students " +
    "student class music workshop workshops resource resources"
  ).split(" "),
);

export function keywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 12);
}

// Matches a keyword at the start of a word so "transition" also finds
// "transitions" and "transitioning".
function wordRegex(word: string, flags: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`, flags);
}

export function searchTranscripts(
  transcripts: Map<string, string>,
  query: string,
  limit = 5,
): TranscriptMatch[] {
  const terms = keywords(query);
  if (terms.length === 0) return [];
  const patterns = terms.map((t) => wordRegex(t, "gi"));

  const scored: { id: string; score: number; text: string }[] = [];
  for (const [id, text] of transcripts) {
    let score = 0;
    let distinct = 0;
    for (const re of patterns) {
      const hits = text.match(re)?.length ?? 0;
      if (hits > 0) distinct++;
      // Diminishing returns so one repeated word can't dominate.
      score += Math.log1p(hits);
    }
    if (distinct === 0) continue;
    // Workshops that cover more of the query's terms rank higher.
    score *= distinct / terms.length;
    scored.push({ id, score, text });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, limit).map(({ id, text }) => ({ id, snippet: bestSnippet(text, terms) }));
}

// Picks the two consecutive sentences that mention the most query terms.
export function bestSnippet(text: string, terms: string[]): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return "";
  const patterns = terms.map((t) => wordRegex(t, "i"));
  const scoreOf = (s: string) => patterns.reduce((n, re) => n + (re.test(s) ? 1 : 0), 0);

  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < sentences.length; i++) {
    const score = scoreOf(sentences[i]) + (i + 1 < sentences.length ? scoreOf(sentences[i + 1]) * 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  const snippet = sentences.slice(bestIndex, bestIndex + 2).join(" ");
  return snippet.length > 400 ? `${snippet.slice(0, 397)}...` : snippet;
}

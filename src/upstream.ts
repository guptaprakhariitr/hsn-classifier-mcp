// HSN classifier — pure local lookup over a static dataset baked into the Worker.
//
// Dataset: 4,676 entries (4-digit headings + 6-digit subheadings) sourced from
// github.com/QuantumByteStudios/gst-hsn-sac-codes (MIT-licensed snapshot of the
// CBIC HSN/GST schedule). Loaded as a TS module so Wrangler bundles + gzips it
// into the Worker shell (~73KB compressed, well under the 1MB limit).
//
// We expose three operations:
//   - lookup_hsn(code)            exact-code lookup
//   - search_hsn(query, limit)    keyword search across descriptions
//   - classify_product(name)      best-match HSN code via keyword scoring

import { HSN_DATA, HsnEntry } from "./hsn-data";

// ── Index built once at module load ──────────────────────────────────────────

const CODE_INDEX = new Map<string, HsnEntry>();
for (const e of HSN_DATA) CODE_INDEX.set(e.code, e);

// Stop-words trimmed out of free-text queries before keyword matching.
const STOPWORDS = new Set([
  "a", "an", "and", "or", "the", "of", "for", "in", "on", "at", "to", "from",
  "with", "without", "by", "is", "are", "be", "as", "into", "any", "all", "such",
  "other", "others", "no", "not", "n.e.s.", "nes", "nesoi", "etc",
  "than", "which", "whether", "their", "this", "that", "these", "those",
  "kind", "kinds", "type", "types", "form", "forms", "used", "use",
  "containing", "including", "include", "includes",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Pre-build a token → entries posting list for fast keyword search.
const POSTINGS = new Map<string, number[]>();
HSN_DATA.forEach((e, idx) => {
  for (const tok of tokenize(e.description)) {
    let lst = POSTINGS.get(tok);
    if (!lst) { lst = []; POSTINGS.set(tok, lst); }
    // Avoid duplicate idx within same entry
    if (lst[lst.length - 1] !== idx) lst.push(idx);
  }
});

// ── Public API ───────────────────────────────────────────────────────────────

export interface LookupResult {
  code: string;
  description: string;
  gst_rate?: number;
}

/** Exact code lookup. Accepts 4 or 6-digit (or 2-digit prefix → returns the first
 *  matching 4-digit heading). */
export function lookupHsn(rawCode: string): LookupResult {
  const code = String(rawCode ?? "").trim().replace(/\D/g, "");
  if (!code) throw new Error("HSN code must contain digits");
  // Exact match first.
  const exact = CODE_INDEX.get(code);
  if (exact) return entryToResult(exact);
  // If they passed a 2-digit chapter prefix, find the first heading.
  if (code.length === 2) {
    for (const e of HSN_DATA) {
      if (e.code.length === 4 && e.code.startsWith(code)) return entryToResult(e);
    }
  }
  // If 8-digit was passed, truncate to 6 then 4.
  if (code.length >= 6) {
    const six = code.slice(0, 6);
    if (CODE_INDEX.has(six)) return entryToResult(CODE_INDEX.get(six)!);
  }
  if (code.length >= 4) {
    const four = code.slice(0, 4);
    if (CODE_INDEX.has(four)) return entryToResult(CODE_INDEX.get(four)!);
  }
  throw new Error(`HSN code '${code}' not found in dataset`);
}

export interface SearchResult {
  matches: LookupResult[];
  total: number;
}

/** Keyword search across descriptions. Returns up to `limit` matches ranked by
 *  matching-token count + an idf-like inverse-frequency boost. */
export function searchHsn(rawQuery: string, limit = 10): SearchResult {
  const tokens = tokenize(String(rawQuery ?? ""));
  if (tokens.length === 0) return { matches: [], total: 0 };

  const scores = new Map<number, number>();
  for (const tok of tokens) {
    const post = POSTINGS.get(tok);
    if (!post || post.length === 0) continue;
    // Less common tokens score higher.
    const idf = Math.log(HSN_DATA.length / (1 + post.length));
    for (const idx of post) {
      scores.set(idx, (scores.get(idx) ?? 0) + 1 + idf);
    }
  }

  // Bonus: exact substring match in description (catches multi-word terms
  // and direct mentions that the tokenizer split apart). Only apply if the
  // raw query (sans surrounding whitespace) is at least 3 chars AND we have
  // at least one token-level hit already — otherwise an unusual long query
  // could match nothing yet still rank entries.
  if (scores.size > 0) {
    const qLower = String(rawQuery ?? "").toLowerCase().trim();
    if (qLower.length >= 3) {
      HSN_DATA.forEach((e, idx) => {
        if (e.description.toLowerCase().includes(qLower)) {
          scores.set(idx, (scores.get(idx) ?? 0) + 5);
        }
      });
    }
  }

  if (scores.size === 0) return { matches: [], total: 0 };

  const ranked = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Math.min(50, limit | 0 || 10)));

  return {
    matches: ranked.map(([idx]) => entryToResult(HSN_DATA[idx])),
    total: scores.size,
  };
}

export interface ClassifyResult {
  best: LookupResult | null;
  alternatives: LookupResult[];
  query: string;
  matched_tokens: string[];
}

/** Best-effort HSN classification for a free-text product name. Returns top
 *  match + a few alternatives. Always returns 200 — caller decides how to use it. */
export function classifyProduct(rawName: string): ClassifyResult {
  const query = String(rawName ?? "").trim();
  const tokens = tokenize(query);
  const matchingTokens = tokens.filter((t) => POSTINGS.has(t));

  if (matchingTokens.length === 0) {
    return { best: null, alternatives: [], query, matched_tokens: [] };
  }

  const { matches } = searchHsn(query, 6);
  return {
    best: matches[0] ?? null,
    alternatives: matches.slice(1),
    query,
    matched_tokens: matchingTokens,
  };
}

function entryToResult(e: HsnEntry): LookupResult {
  const out: LookupResult = { code: e.code, description: e.description };
  if (typeof e.gst_rate === "number") out.gst_rate = e.gst_rate;
  return out;
}

// Expose dataset stats so /health can report them.
export const DATASET_STATS = {
  count: HSN_DATA.length,
  source: "github.com/QuantumByteStudios/gst-hsn-sac-codes (MIT) — trimmed to 4 & 6-digit headings",
};

// Copy-claim heuristic for the stealth gate (README.md, "Copy claims").
// A claim from COPY_CLAIMS is reported unless
//   1. it is a CSS class name rather than copy (only claims with `classLike`), or
//   2. its own clause negates it ("Geek never ...", "No ... mode"), or
//   3. the nearest list heading above it is negated ("Geek won’t", "What Geek will not do").
// The caller passes normalized text; for JS-family files, with comments blanked.
import {
  CLASS_LIKE_AFTER,
  CLASS_LIKE_BEFORE,
  CLAUSE_BREAK,
  CLAUSE_MAX,
  COPY_CLAIMS,
  LABEL,
  LABEL_NEGATED,
  LABEL_SPLIT,
  LABEL_WINDOW_LINES,
  NEGATOR,
  PSEUDO_NEGATOR,
  UTILITY_TOKEN,
  UTILITY_WORDS,
} from './patterns.mjs';

const QUOTE_OR_EOL = /['"`\n]/;

/** True when the match reads as a class name (`.x`, `hover:x`, `x-y`, or a phrase of utility tokens). */
export function isClassLike(text, index, length) {
  const before = text[index - 1] ?? '';
  const after = text[index + length] ?? '';
  if (CLASS_LIKE_BEFORE.test(before) || CLASS_LIKE_AFTER.test(after)) return true;
  let start = index;
  while (start > 0 && !QUOTE_OR_EOL.test(text[start - 1])) start--;
  let end = index + length;
  while (end < text.length && !QUOTE_OR_EOL.test(text[end])) end++;
  const tokens = text.slice(start, end).trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => UTILITY_WORDS.has(t) || UTILITY_TOKEN.test(t));
}

/** True when the clause before `index` holds a real negator. */
export function negatedInClause(text, index) {
  const before = text.slice(Math.max(0, index - CLAUSE_MAX), index);
  let cut = 0;
  for (const b of before.matchAll(CLAUSE_BREAK)) cut = b.index + b[0].length;
  const clause = before.slice(cut).replace(PSEUDO_NEGATOR, ' ');
  return NEGATOR.test(clause);
}

/** True when the nearest heading-shaped phrase in the lines above is negated. */
export function negatedByLabel(text, index) {
  let begin = index;
  for (let lines = 0; begin > 0; begin--) {
    if (text[begin - 1] === '\n' && ++lines > LABEL_WINDOW_LINES) break;
  }
  const phrases = text.slice(begin, index).split(LABEL_SPLIT);
  for (let i = phrases.length - 1; i >= 0; i--) {
    const phrase = phrases[i].trim().replace(/\s+/g, ' ');
    if (phrase && LABEL.test(phrase)) return LABEL_NEGATED.test(phrase);
  }
  return false;
}

/**
 * Copy claims in `text` as { id, index, length, message }. With `only`, a
 * matched claim counts only when its text also matches `only`.
 */
export function findCopyClaims(text, { only } = {}) {
  const hits = [];
  for (const claim of COPY_CLAIMS) {
    for (const m of text.matchAll(claim.re)) {
      if (only && !only.test(m[0])) continue;
      if (claim.classLike?.test(m[0]) && isClassLike(text, m.index, m[0].length)) continue;
      if (negatedInClause(text, m.index) || negatedByLabel(text, m.index)) continue;
      hits.push({ id: claim.id, index: m.index, length: m[0].length, message: claim.message });
    }
  }
  return hits;
}

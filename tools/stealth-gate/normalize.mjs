// Source normalization for the stealth gate. Rewrites common ways of spelling a
// banned name indirectly into the plain name, so the pattern list in
// patterns.mjs only has to match literal text. Every rewrite keeps the number of
// line breaks, so findings still point at the line where the expression starts.
//
// Handled (README.md lists what stays out of scope):
//   - \uXXXX, \u{...} and \xXX escapes and &#NN; / &#xNN; character references
//     that decode to identifier-safe characters
//   - 'a' + 'b', with whitespace or comments around the +
//   - ['a', 'b'].join('') and 'a'.concat('b', 'c')
//   - ('a') + ('b') grouping parentheses around a lone literal
//   - `a${'b'}c` template substitutions that are literals
//   - 'cba'.split('').reverse().join('') and [...'cba'].reverse().join('')
//   - String.fromCharCode(97, 98)
//   - same-file const string values used as win[k], `${k}`, k + 'x' or f(k)
//     (JS-family files only; const only, because let and var can be reassigned)
//   - same-file aliases of the Dock object
import { lex } from '../lib/lexer.mjs';
import { DOCK_ALIAS_DECL, DOCK_ALIAS_DESTRUCTURE, DOCK_WORD, dockAliasUse } from './patterns.mjs';

const LIT = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\\n])*)\1`;
const lit = (n) => '([\'"\\x60])((?:\\\\.|(?!\\' + n + ')[^\\\\\\n])*)\\' + n;
const GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*`;

const CONCAT = new RegExp(`${LIT}${GAP}\\+${GAP}${lit(3)}`, 'g');
const JOIN = /\[\s*((?:(['"`])(?:\\.|(?!\2)[^\\\n])*\2\s*,\s*)*(['"`])(?:\\.|(?!\3)[^\\\n])*\3\s*,?\s*)\]\s*\.\s*\bjoin\s*\(\s*(['"`])\4\s*\)/g;
const FRAGMENT = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const CONCAT_CALL = new RegExp(
  `${LIT}\\s*\\.\\s*concat\\s*\\(\\s*((?:(['"\\x60])(?:\\\\.|(?!\\4)[^\\\\\\n])*\\4\\s*,?\\s*)+)\\)`,
  'g',
);
const PARENS = new RegExp(`(^|[=+,:;(\\[{!&|?])(\\s*)\\(\\s*${lit(3)}\\s*\\)`, 'gm');
const PARENS_HINT = /(?:^|[=+,:;([{!&|?])\s*\(\s*['"`]/m;
const TEMPLATE_SUB = new RegExp(`\\$\\{\\s*${LIT}\\s*\\}`, 'g');
const REVERSE = new RegExp(
  `(?:${LIT}\\s*\\.\\s*split\\s*\\(\\s*(['"\\x60])\\3\\s*\\)|\\[\\s*\\.\\.\\.\\s*${lit(4)}\\s*\\])\\s*\\.\\s*reverse\\s*\\(\\s*\\)\\s*\\.\\s*join\\s*\\(\\s*(['"\\x60])\\6\\s*\\)`,
  'g',
);
const FROM_CHAR_CODE = /\bString\s*\.\s*fromCharCode\s*\(\s*((?:0x[0-9a-f]+|\d+)(?:\s*,\s*(?:0x[0-9a-f]+|\d+))*)\s*\)/gi;
const ESCAPE = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g;
const ENTITY = /&#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}));/g;
const SAFE_CHAR = /^[A-Za-z0-9_$.:/@ -]$/;
const CONST_DECL = new RegExp(
  `\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*(?::\\s*[\\w$.<>\\[\\]|&\\s'"]+?)?\\s*=\\s*${lit(2)}\\s*(?:as\\s+const\\s*)?(?=\\s*(?:[;,)\\r\\n/]|$))`,
  'g',
);
const IDENT_VALUE = /^[\w$.:/ -]{1,64}$/;
const MAX_CONSTS = 400;
const MAX_PASSES = 30;

const newlines = (s) => '\n'.repeat((s.match(/\n/g) ?? []).length);

function decodeEscapes(text) {
  const safe = (m, code) => {
    if (!(code <= 0x10ffff)) return m;
    const ch = String.fromCodePoint(code);
    return SAFE_CHAR.test(ch) ? ch : m;
  };
  return text
    .replace(ESCAPE, (m, braced, four, two) => safe(m, parseInt(braced ?? four ?? two, 16)))
    .replace(ENTITY, (m, hex, dec) => safe(m, hex ? parseInt(hex, 16) : Number(dec)));
}

function joinPass(text) {
  let out = text;
  // Each step runs only when its marker is present; most files need none of them.
  if (out.includes('${')) out = out.replace(TEMPLATE_SUB, (m, _q, body) => `${body}${newlines(m)}`);
  if (PARENS_HINT.test(out)) {
    out = out.replace(PARENS, (m, lead, space, q, body) => `${lead}${space}${q}${body}${q}${newlines(m)}`);
  }
  if (out.includes('concat')) {
    out = out.replace(CONCAT_CALL, (m, q, first, rest) => {
      const parts = [...rest.matchAll(FRAGMENT)].map((p) => p[2]);
      return `${q}${first}${parts.join('')}${q}${newlines(m)}`;
    });
  }
  if (out.includes('+')) out = out.replace(CONCAT, (m, q, a, _q2, b) => `${q}${a}${b}${q}${newlines(m)}`);
  if (out.includes('join')) {
    out = out.replace(JOIN, (m, inner) => {
      const parts = [...inner.matchAll(FRAGMENT)].map((p) => p[2]);
      return `'${parts.join('')}'${newlines(m)}`;
    });
  }
  if (out.includes('reverse')) {
    out = out.replace(REVERSE, (m, q1, a, _e, q2, b) => {
      const body = a ?? b ?? '';
      return `${q1 ?? q2}${[...body].reverse().join('')}${q1 ?? q2}${newlines(m)}`;
    });
  }
  if (out.includes('fromCharCode')) {
    out = out.replace(FROM_CHAR_CODE, (m, list) => {
      const chars = list.split(',').map((n) => String.fromCodePoint(Number(n.trim())));
      return chars.every((c) => SAFE_CHAR.test(c)) ? `'${chars.join('')}'${newlines(m)}` : m;
    });
  }
  return out;
}

/** Same-file `const NAME = 'literal'` values that are unambiguous (declared once). */
export function collectConsts(text) {
  const seen = new Map();
  for (const m of text.matchAll(CONST_DECL)) {
    const [, name, quote, value] = m;
    if (value.includes('${') || !IDENT_VALUE.test(value)) continue;
    const prev = seen.get(name);
    if (prev === undefined) seen.set(name, { quote, value });
    else if (prev && prev.value !== value) seen.set(name, null);
  }
  const consts = new Map();
  for (const [name, v] of seen) if (v) consts.set(name, v);
  return consts.size > MAX_CONSTS ? new Map() : consts;
}

const escapeRe = (s) => s.replace(/[$]/g, '\\$');

/** Replaces same-file const identifiers in value positions (code segments only). */
function substituteConsts(text) {
  const consts = collectConsts(text);
  if (consts.size === 0) return text;
  const names = [...consts.keys()].map(escapeRe).join('|');
  const use = new RegExp(
    `(?<![\\w$.])(?<!\\b(?:const|let|var|function|class|import|export|as|type|interface|enum)\\s+)(${names})(?![\\w$])(?!\\s*(?::(?!:)|=(?![=>])|=>|\\())`,
    'g',
  );
  use.lastIndex = 0;
  if (!use.test(text)) return text;
  use.lastIndex = 0;
  let out = '';
  let pos = 0;
  for (const seg of lex(text, 'js')) {
    if (seg.kind !== 'code') continue;
    out += text.slice(pos, seg.start);
    out += text.slice(seg.start, seg.end).replace(use, (name) => {
      const { quote, value } = consts.get(name);
      return `${quote}${value}${quote}`;
    });
    pos = seg.end;
  }
  return out + text.slice(pos);
}

function resolveDockAliases(text) {
  const aliases = new Set();
  for (const m of text.matchAll(DOCK_ALIAS_DECL)) aliases.add(m[1]);
  for (const m of text.matchAll(DOCK_ALIAS_DESTRUCTURE)) aliases.add(m[1]);
  aliases.delete(DOCK_WORD);
  let out = text;
  for (const name of aliases) out = out.replace(dockAliasUse(name), DOCK_WORD);
  return out;
}

/**
 * Normalizes `text` for matching. `js` enables the JS-only steps (const
 * resolution and Dock aliases). The result has the same number of lines.
 */
export function normalize(text, { js = false } = {}) {
  let out = decodeEscapes(text);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let next = joinPass(out);
    if (js) next = substituteConsts(next);
    if (next === out) break;
    out = next;
  }
  return js ? resolveDockAliases(out) : out;
}

/** The fragment-joining steps alone (kept for callers that only need those). */
export function normalizeConcatenation(text) {
  return normalize(text, { js: false });
}

// Lightweight lexer that splits source text into code, string, regex and
// comment segments so lint rules can look only where a rule applies (for
// example, copy rules read string contents and ignore comments). It favours
// recovery over precision: unterminated quotes end at the line break.

const REGEX_PREFIX = new Set([...'(,=:[!&|?{};+-*%<>~^}']);
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new',
  'delete', 'void', 'throw', 'instanceof', 'yield', 'await',
]);

// Char-code checks: the lexer runs over every scanned file, so no regex per character.
const isWordChar = (c) => {
  if (c === undefined || c === '') return false;
  const k = c.charCodeAt(0);
  return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122) || k === 95 || k === 36;
};
const isSpace = (c) => {
  const k = c.charCodeAt(0);
  return k === 32 || (k >= 9 && k <= 13) || (k > 127 && /\s/.test(c));
};

export function langForExt(ext) {
  switch (ext) {
    case '.ts': case '.tsx': case '.mts': case '.cts':
    case '.js': case '.jsx': case '.mjs': case '.cjs':
      return 'js';
    case '.css':
      return 'css';
    case '.html':
      return 'html';
    default:
      return 'text';
  }
}

export function lex(text, lang) {
  if (lang === 'js') return lexJs(text);
  if (lang === 'css') return lexCss(text);
  if (lang === 'html') return lexHtml(text);
  return [{ kind: 'code', start: 0, end: text.length }];
}

function lexJs(text) {
  const segs = [];
  const n = text.length;
  const braceStack = [];
  let i = 0;
  let codeStart = 0;
  let lastSig = '';
  let lastWord = '';

  const flush = (end) => {
    if (end > codeStart) segs.push({ kind: 'code', start: codeStart, end });
  };

  // Scans template text from `from`; returns the index where code resumes.
  const scanTemplate = (from) => {
    let j = from;
    while (j < n) {
      const c = text[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        segs.push({ kind: 'string', start: from, end: j });
        lastSig = '`';
        return j;
      }
      if (c === '$' && text[j + 1] === '{') {
        segs.push({ kind: 'string', start: from, end: j });
        braceStack.push(0);
        lastSig = '{';
        return j;
      }
      j++;
    }
    segs.push({ kind: 'string', start: from, end: n });
    return n;
  };

  while (i < n) {
    const c = text[i];
    const d = text[i + 1];

    if (c === '/' && d === '/') {
      flush(i);
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      segs.push({ kind: 'comment', start: i, end: j });
      i = codeStart = j;
      continue;
    }
    if (c === '/' && d === '*') {
      flush(i);
      const close = text.indexOf('*/', i + 2);
      const j = close < 0 ? n : close + 2;
      segs.push({ kind: 'comment', start: i, end: j });
      i = codeStart = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      j = Math.min(j, n);
      flush(i + 1);
      segs.push({ kind: 'string', start: i + 1, end: j });
      codeStart = j;
      i = j < n && text[j] === c ? j + 1 : j;
      lastSig = c;
      lastWord = '';
      continue;
    }
    if (c === '`') {
      flush(i + 1);
      const resume = scanTemplate(i + 1);
      codeStart = resume;
      i = resume < n && text[resume] === '`' ? resume + 1 : resume + 2;
      lastWord = '';
      continue;
    }
    if (braceStack.length > 0 && (c === '{' || c === '}')) {
      const top = braceStack.length - 1;
      if (c === '{') {
        braceStack[top] += 1;
      } else if (braceStack[top] === 0) {
        braceStack.pop();
        flush(i + 1);
        const resume = scanTemplate(i + 1);
        codeStart = resume;
        i = resume < n && text[resume] === '`' ? resume + 1 : resume + 2;
        lastWord = '';
        continue;
      } else {
        braceStack[top] -= 1;
      }
    }
    if (c === '/') {
      const regexAllowed =
        lastSig === '' ||
        REGEX_PREFIX.has(lastSig) ||
        (isWordChar(lastSig) && REGEX_KEYWORDS.has(lastWord));
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        while (j < n && text[j] !== '\n') {
          const ch = text[j];
          if (ch === '\\') {
            j += 2;
            continue;
          }
          if (inClass) {
            if (ch === ']') inClass = false;
          } else if (ch === '[') {
            inClass = true;
          } else if (ch === '/') {
            break;
          }
          j++;
        }
        if (j < n && text[j] === '/') {
          let end = j + 1;
          while (end < n && /[a-z]/i.test(text[end])) end++;
          flush(i);
          segs.push({ kind: 'regex', start: i, end });
          i = codeStart = end;
          lastSig = 'a';
          lastWord = '';
          continue;
        }
      }
    }
    if (!isSpace(c)) {
      if (isWordChar(c)) {
        lastWord = isWordChar(lastSig) && i > 0 && isWordChar(text[i - 1]) ? lastWord + c : c;
      } else {
        lastWord = '';
      }
      lastSig = c;
    }
    i++;
  }
  flush(n);
  return segs;
}

function lexCss(text) {
  const segs = [];
  const n = text.length;
  let i = 0;
  let codeStart = 0;
  const flush = (end) => {
    if (end > codeStart) segs.push({ kind: 'code', start: codeStart, end });
  };
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      flush(i);
      const close = text.indexOf('*/', i + 2);
      const j = close < 0 ? n : close + 2;
      segs.push({ kind: 'comment', start: i, end: j });
      i = codeStart = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      j = Math.min(j, n);
      flush(i + 1);
      segs.push({ kind: 'string', start: i + 1, end: j });
      codeStart = j;
      i = j < n && text[j] === c ? j + 1 : j;
      continue;
    }
    i++;
  }
  flush(n);
  return segs;
}

function lexHtml(text) {
  const segs = [];
  let codeStart = 0;
  let i = text.indexOf('<!--');
  while (i >= 0) {
    if (i > codeStart) segs.push({ kind: 'code', start: codeStart, end: i });
    const close = text.indexOf('-->', i + 4);
    const end = close < 0 ? text.length : close + 3;
    segs.push({ kind: 'comment', start: i, end });
    codeStart = end;
    i = text.indexOf('<!--', end);
  }
  if (codeStart < text.length) segs.push({ kind: 'code', start: codeStart, end: text.length });
  return segs;
}

/**
 * Returns `text` with every segment whose kind is not in `keep` blanked out.
 * Newlines survive, so offsets, lines and columns match the original.
 */
export function mask(text, segs, keep) {
  let out = '';
  let pos = 0;
  for (const s of segs) {
    if (s.start > pos) out += blank(text.slice(pos, s.start));
    const chunk = text.slice(s.start, s.end);
    out += keep.has(s.kind) ? chunk : blank(chunk);
    pos = s.end;
  }
  if (pos < text.length) out += blank(text.slice(pos));
  return out;
}

function blank(chunk) {
  return chunk.replace(/[^\n]/g, ' ');
}

const NON_COMMENT = new Set(['code', 'string', 'regex']);
const STRINGS = new Set(['string']);

/** Masked views of a file: everything except comments, and string contents only. */
export function views(text, lang) {
  const segs = lex(text, lang);
  return {
    nonComment: mask(text, segs, NON_COMMENT),
    strings: mask(text, segs, STRINGS),
  };
}

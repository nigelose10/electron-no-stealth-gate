#!/usr/bin/env node
// Stealth gate: fails on any API, constant, config or copy that would keep Geek
// out of screen capture, the taskbar, the Dock or Mission Control, pose as the
// Moodle app or register its URL scheme system-wide, or call eClass write
// functions. Pattern data lives in ./patterns.mjs; README.md has the rules.
//
// Two modes:
//   source (default)  every source and config file in the repo, build output excluded
//   built             what ships: apps/*/out, apps/*/dist, apps/*/.vercel/output,
//                     packages/*/dist and the packaged resources under
//                     apps/*/release (every app.asar entry is read, and
//                     app.asar.unpacked is walked with its node_modules)
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  FIXTURE_GLOB,
  KNOWN_BINARY_EXTS,
  REPO_ROOT,
  classifyBuffer,
  extOf,
  isMain,
  isTestPath,
  lineAt,
  lineStarts,
  positionAt,
  printableStrings,
  readForScan,
  walk,
} from '../lib/files.mjs';
import { lex, langForExt, mask, views } from '../lib/lexer.mjs';
import { clip, printResult } from '../lib/report.mjs';
import { readAsar } from './asar.mjs';
import { findCopyClaims } from './copy-claims.mjs';
import { normalize, normalizeConcatenation } from './normalize.mjs';
import {
  ALLOWED_DEFAULT_SCHEMES,
  DEFAULT_PROTOCOL,
  DEFAULT_PROTOCOL_CALL,
  IMPLICIT_DOCK_HIDE,
  LEGACY_COMMENT_CLAIMS,
  MOODLE_SCHEME,
  MOODLE_SCHEME_AFTER,
  MOODLE_SCHEME_BEFORE,
  PATTERNS,
} from './patterns.mjs';

export { normalizeConcatenation };

// The whole repo is walked; tools/lib/files.mjs prunes node_modules, .git and
// build output at its anchored locations.
export const STEALTH_DIRS = ['.'];

export const STEALTH_EXTS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.vue', '.astro', '.mdx',
  '.json', '.json5', '.jsonc', '.toml', '.yml', '.yaml', '.xml', '.plist', '.entitlements', '.ini', '.desktop', '.reg',
  '.html', '.css',
  // Installer scripts and patches can carry Info.plist or registry edits.
  '.nsh', '.nsi', '.iss', '.patch', '.diff',
  // Native helpers are where capture exclusion would really live.
  '.swift', '.m', '.mm', '.h', '.c', '.cc', '.cpp', '.hpp', '.rs', '.cs', '.go', '.java', '.kt',
  '.py', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.vbs', '.applescript',
]);

// Extensionless or dot-named config files at any depth.
export const STEALTH_NAMES = new Set([
  '.npmrc', '.yarnrc', '.editorconfig', '.gitattributes', '.nvmrc', '.node-version', '.env.example',
  'CODEOWNERS', 'Dockerfile', 'Makefile', 'Procfile',
]);

export const STEALTH_EXCLUDES = [FIXTURE_GLOB, 'tools/stealth-gate/patterns.mjs'];

// Config-type files: any mention of the Moodle app's URL scheme is a finding.
export const CONFIG_EXTS = new Set([
  '.json', '.json5', '.jsonc', '.toml', '.yml', '.yaml', '.xml', '.plist', '.entitlements', '.ini', '.desktop',
  '.reg', '.nsh', '.nsi', '.iss',
]);
const CONFIG_NAMES = new Set(['.npmrc', '.yarnrc']);

export function isConfigFile(relPath) {
  const name = basename(relPath);
  return CONFIG_EXTS.has(extOf(name)) || CONFIG_NAMES.has(name);
}

function moodleSchemeAllowed(text, index) {
  // Only the all-lower-case scheme spelling is exempt; any capital letter reads as the user agent.
  if (text.slice(index, index + 12) !== text.slice(index, index + 12).toLowerCase()) return false;
  const rest = text.slice(index, index + 64);
  if (MOODLE_SCHEME_AFTER.some((re) => re.test(rest))) return true;
  const before = text.slice(Math.max(0, index - 80), index);
  return MOODLE_SCHEME_BEFORE.some((re) => re.test(before));
}

/** First argument of a call whose `(` ends at `from`: { literal, end }; literal is null when not a plain literal. */
function firstArgument(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  const q = text[i];
  if (q === "'" || q === '"' || q === '`') {
    let j = i + 1;
    while (j < text.length && text[j] !== q && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
    const body = text.slice(i + 1, j);
    if (text[j] === q && !(q === '`' && body.includes('${'))) return { literal: body, raw: body, end: j + 1 };
  }
  let depth = 0;
  let j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
  }
  return { literal: null, raw: text.slice(i, j), end: j };
}

function insideAny(ranges, index) {
  return ranges.some((r) => index >= r.start && index < r.end);
}

function defaultProtocolHits(text, lang) {
  const hits = [];
  let comments = null;
  for (const m of text.matchAll(DEFAULT_PROTOCOL_CALL)) {
    const arg = firstArgument(text, m.index + m[0].length);
    const length = arg.end - m.index;
    if (MOODLE_SCHEME.test(arg.literal ?? arg.raw)) {
      hits.push({ ...DEFAULT_PROTOCOL.moodle, index: m.index, length });
      continue;
    }
    if (arg.literal !== null && ALLOWED_DEFAULT_SCHEMES.has(arg.literal)) continue;
    comments ??= lang === 'js' ? lex(text, 'js').filter((s) => s.kind === 'comment') : [];
    if (insideAny(comments, m.index)) continue;
    hits.push({ ...DEFAULT_PROTOCOL.other, index: m.index, length });
  }
  return hits;
}

/** The `{...}` object literal enclosing `index`, or null. */
function enclosingObject(text, index) {
  let depth = 0;
  let start = -1;
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = index; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0) return text.slice(start, i + 1);
      depth--;
    }
  }
  return null;
}

function implicitDockHits(text, lang) {
  if (!/visibleOnFullScreen/i.test(text)) return [];
  const view = lang === 'js' ? views(text, 'js').nonComment : text;
  const rule = IMPLICIT_DOCK_HIDE;
  const hits = [];
  for (const m of view.matchAll(rule.key)) {
    const value = m[2] ?? m[3];
    if (value !== undefined && rule.off.test(value)) continue;
    const object = m[0].startsWith('.') ? null : enclosingObject(view, m.index);
    if (object && rule.guard.test(object)) continue;
    hits.push({ id: rule.id, index: m.index, length: m[0].trimEnd().length, message: rule.message });
  }
  return hits;
}

// Copy claims read everything but JS comments, including comments of code
// embedded in multi-line template literals (GLSL, CSS, SQL). In source mode the
// two legacy phrases are also checked inside comments, as the gate always did.
function copyClaimHits(text, lang, { shipped }) {
  if (lang !== 'js') return findCopyClaims(text);
  const segs = lex(text, 'js');
  const hits = findCopyClaims(blankEmbeddedComments(mask(text, segs, CODE_AND_STRINGS), segs));
  if (!shipped && LEGACY_COMMENT_CLAIMS.test(text)) {
    hits.push(...findCopyClaims(mask(text, segs, COMMENTS), { only: LEGACY_COMMENT_CLAIMS }));
  }
  return hits;
}

const CODE_AND_STRINGS = new Set(['code', 'string', 'regex']);
const EMBEDDED_COMMENT = /(?<![:\w])\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function blankEmbeddedComments(view, segs) {
  let out = view;
  for (const s of segs) {
    if (s.kind !== 'string') continue;
    const body = view.slice(s.start, s.end);
    if (!body.includes('\n')) continue;
    const blanked = body.replace(EMBEDDED_COMMENT, (m) => m.replace(/[^\n]/g, ' '));
    if (blanked !== body) out = out.slice(0, s.start) + blanked + out.slice(s.end);
  }
  return out;
}
const COMMENTS = new Set(['comment']);

/**
 * Scans one file's text. Options:
 *   shipped  every rule applies, test paths included (built output)
 *   binary   text is the printable strings of a binary; only API and data rules run
 */
export function scanText(relPath, text, { shipped = false, binary = false } = {}) {
  const findings = [];
  const testPath = !shipped && isTestPath(relPath);
  const lang = binary ? 'text' : langForExt(extOf(relPath));
  const config = !binary && isConfigFile(relPath);
  const normalized = binary ? text : normalize(text, { js: lang === 'js' });
  const starts = lineStarts(normalized);
  const rawStarts = normalized === text ? starts : lineStarts(text);
  const seen = [];

  const record = (rule, index, length, message) => {
    if (seen.some((s) => index < s.end && index + length > s.start)) return;
    seen.push({ start: index, end: index + length });
    const matched = normalized.slice(index, index + length);
    if (binary) {
      findings.push({ file: relPath, rule, message: `${message} Found "${clip(matched)}" in the binary's strings.` });
      return;
    }
    const { line, col } = positionAt(starts, index);
    const rawLine = lineAt(text, rawStarts, line);
    const joined = rawLine.includes(matched) ? '' : ' (after joining split string fragments)';
    findings.push({ file: relPath, line, col, rule, message: `${message} Found "${clip(matched)}"${joined}.` });
  };

  const hits = [];
  for (const p of PATTERNS) {
    if (p.scope === 'source' && testPath) continue;
    if (p.configOnly && !config) continue;
    if (p.skipPaths?.test(relPath)) continue;
    for (const m of normalized.matchAll(p.re)) {
      if (p.allow === 'moodle-scheme' && moodleSchemeAllowed(normalized, m.index)) continue;
      hits.push({ id: p.id, index: m.index, length: m[0].length, message: p.message });
    }
  }
  hits.push(...defaultProtocolHits(normalized, lang));
  if (!binary) {
    hits.push(...implicitDockHits(normalized, lang));
    if (!testPath) hits.push(...copyClaimHits(normalized, lang, { shipped }));
  }
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  for (const h of hits) record(h.id, h.index, h.length, h.message);
  return findings;
}

const unscannable = (file, reason) => ({
  file,
  rule: 'unscannable',
  message: `${file} ${reason}. The gate cannot prove it is clean; fix or remove it.`,
});

/**
 * Scans one buffer. Text is scanned as is; NUL bytes and binary plists are
 * reported (and their readable content is still scanned); known binary assets
 * are skipped, except native modules (.node), whose strings are scanned.
 */
export function scanBuffer(relPath, buf, { shipped = false } = {}) {
  const ext = extOf(relPath);
  if (KNOWN_BINARY_EXTS.has(ext)) {
    if (ext !== '.node') return { findings: [], skipped: true };
    return { findings: scanText(relPath, printableStrings(buf), { shipped: true, binary: true }) };
  }
  return scanContent(relPath, classifyBuffer(buf), { shipped });
}

function scanContent(relPath, content, { shipped }) {
  switch (content.kind) {
    case 'text':
      return { findings: scanText(relPath, content.text, { shipped }) };
    case 'nul':
      return {
        findings: [
          unscannable(relPath, 'contains NUL bytes (binary data or UTF-16 text in a source file)'),
          ...scanText(relPath, content.text, { shipped }),
        ],
      };
    case 'bplist':
      return {
        findings: [
          {
            file: relPath,
            rule: 'needs-review',
            message: `${relPath} is a binary property list. Commit plists as XML (plutil -convert xml1) so the gate can read them.`,
          },
          ...scanText(relPath, content.text, { shipped, binary: true }),
        ],
      };
    case 'too-large':
      return { findings: [unscannable(relPath, `is ${content.size} bytes, over the scan limit`)] };
    default:
      return { findings: [unscannable(relPath, `could not be read (${content.reason})`)] };
  }
}

export function collectFiles({ root = REPO_ROOT, dirs = STEALTH_DIRS, exclude = STEALTH_EXCLUDES, problems } = {}) {
  const files = new Set();
  for (const dir of dirs) {
    for (const f of walk(root, dir, { exts: STEALTH_EXTS, names: STEALTH_NAMES, exclude, problems })) files.add(f);
  }
  return [...files].sort();
}

const BUILT_ROOTS = ['out', 'dist', 'release', '.vercel/output'];
const PACKAGED = [
  /(^|\/)[Rr]esources\/app\.asar$/,
  /(^|\/)[Rr]esources\/app\.asar\.unpacked\//,
  /(^|\/)[Rr]esources\/app\//,
  /(^|\/)[^/]+\.app\/Contents\/Info\.plist$/,
  /\.(?:nsh|nsi|desktop)$/,
  /(^|\/)builder-(?:effective-config|debug)\.ya?ml$/,
];

function isPackagedResource(rel) {
  return PACKAGED.some((re) => re.test(rel)) && !/\/Frameworks\//.test(rel);
}

export function collectBuiltFiles({ root = REPO_ROOT, problems } = {}) {
  const roots = [];
  const files = [];
  for (const group of ['apps', 'packages']) {
    for (const pkg of walkDirs(root, group)) {
      for (const name of BUILT_ROOTS) {
        if (group === 'packages' && name !== 'dist') continue;
        const rel = `${group}/${pkg}/${name}`;
        const listed = walk(root, rel, { generated: true, dependencies: true, problems });
        if (listed.length === 0) continue;
        roots.push(rel);
        files.push(...(name === 'release' ? listed.filter(isPackagedResource) : listed));
      }
    }
  }
  return { roots, files: files.sort() };
}

function walkDirs(root, group) {
  try {
    return readdirSync(join(root, group), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function runSource(root, options) {
  const problems = [];
  const files = collectFiles({ ...options, root, problems });
  const findings = problems.map((p) => unscannable(p.file, p.reason));
  let scanned = 0;
  for (const rel of files) {
    scanned++;
    findings.push(...scanContent(rel, readForScan(join(root, rel)), { shipped: false }).findings);
  }
  return {
    findings,
    notes: ['source mode: build output (apps/*/out, dist, release) is checked by `run-gates.mjs --built`'],
    scanned,
  };
}

function runBuilt(root) {
  const problems = [];
  const { roots, files } = collectBuiltFiles({ root, problems });
  const findings = problems.map((p) => unscannable(p.file, p.reason));
  if (roots.length === 0) {
    findings.push({
      file: 'apps',
      rule: 'no-build-output',
      message: 'No build output found under apps/*/out, apps/*/dist, apps/*/release or packages/*/dist. Build first; the built pass never passes on an empty tree.',
    });
    return { findings, notes: [], scanned: 0 };
  }
  const listedFiles = new Set(files);
  let scanned = 0;
  let skipped = 0;
  let native = 0;
  for (const rel of files) {
    const abs = join(root, rel);
    if (rel.endsWith('.asar')) {
      let entries;
      try {
        entries = readAsar(readFileSync(abs));
      } catch (err) {
        findings.push(unscannable(rel, `is not a readable asar archive (${err.message})`));
        continue;
      }
      for (const entry of entries) {
        if (entry.unpacked) {
          const onDisk = `${rel}.unpacked/${entry.path}`;
          if (!listedFiles.has(onDisk)) {
            findings.push(unscannable(`${rel}/${entry.path}`, `is marked unpacked, but ${onDisk} was not found by the built scan`));
          }
          continue;
        }
        if (!entry.data) continue;
        const result = scanBuffer(`${rel}/${entry.path}`, entry.data, { shipped: true });
        if (result.skipped) skipped++;
        else scanned++;
        if (extOf(entry.path) === '.node') native++;
        findings.push(...result.findings);
      }
      continue;
    }
    if (KNOWN_BINARY_EXTS.has(extOf(rel)) && extOf(rel) !== '.node') {
      skipped++;
      continue;
    }
    const content = readForScan(abs);
    const isNative = extOf(rel) === '.node' && (content.kind === 'nul' || content.kind === 'text');
    const result = isNative ? scanBuffer(rel, readFileSync(abs), { shipped: true }) : scanContent(rel, content, { shipped: true });
    if (isNative) native++;
    scanned++;
    findings.push(...result.findings);
  }
  return {
    findings,
    notes: [
      `built mode: scanned ${roots.join(', ')}; known binary assets (images, fonts) skipped: ${skipped}`,
      `built mode: native modules (.node) scanned for printable strings: ${native}`,
    ],
    scanned,
  };
}

export function runStealthGate(options = {}) {
  const root = options.root ?? REPO_ROOT;
  return options.mode === 'built' ? runBuilt(root) : runSource(root, options);
}

if (isMain(import.meta.url)) {
  const mode = process.argv.includes('--built') ? 'built' : 'source';
  const ok = printResult('stealth', runStealthGate({ mode }));
  process.exitCode = ok ? 0 : 1;
}

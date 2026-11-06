import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Dependency and VCS folders are skipped at any depth. The license gate covers
// dependencies; .git is not source. A walk with `dependencies: true` (the
// stealth gate's --built pass) keeps node_modules, because inside build output
// they ship: app.asar.unpacked/node_modules holds the native modules.
export const DEPENDENCY_DIRS = new Set(['node_modules', '.git']);
const VCS_DIRS = new Set(['.git']);

// Build output, pruned only at these exact places (anchored at the repo root,
// never by folder name at any depth, so `src/main/release/` is still scanned).
// `run-gates.mjs --built` scans these roots on purpose.
export const BUILD_OUTPUT_GLOBS = [
  'apps/*/out/**',
  'apps/*/dist/**',
  'apps/*/release/**',
  'apps/*/.vercel/output/**',
  'packages/*/dist/**',
];

// Everything a source scan skips: build output, coverage reports (copies of
// source) and local spike results (gitignored; may hold personal data).
export const GENERATED_GLOBS = [
  ...BUILD_OUTPUT_GLOBS,
  'coverage/**',
  'apps/*/coverage/**',
  'packages/*/coverage/**',
  'spikes/out/**',
];

// Gate fixtures intentionally contain violations; real scans skip them.
export const FIXTURE_GLOB = 'tools/*/fixtures/**';

// Files with these extensions are binary by design and never reported as unscannable.
export const KNOWN_BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.icns', '.node',
]);

export const MAX_SCAN_BYTES = 32 * 1024 * 1024;

export function toPosix(p) {
  return p.split(sep).join('/');
}

export function extOf(name) {
  return extname(name).toLowerCase();
}

const globCache = new Map();

export function globToRegExp(glob) {
  let cached = globCache.get(glob);
  if (cached) return cached;
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  cached = new RegExp(`^${re}$`);
  globCache.set(glob, cached);
  return cached;
}

export function matchesAny(relPath, globs) {
  return globs.some((g) => globToRegExp(g).test(relPath));
}

function isInside(rootReal, target) {
  return target === rootReal || target.startsWith(rootReal + sep);
}

/**
 * Recursively lists files under `root/startRel` as repo-relative POSIX paths.
 *
 * - .git is pruned at any depth, and so is node_modules unless `dependencies`
 *   is true (build output scans, where node_modules ship).
 * - GENERATED_GLOBS (build output, coverage, spike results) are pruned at their
 *   anchored locations unless `generated` is true.
 * - Directories or files matching an `exclude` glob are pruned.
 * - Symlinks that resolve inside the repo are followed (once per real path).
 *   Dangling links and links that leave the repo are pushed to `problems`
 *   ({ file, reason }) when given, so a gate can fail closed on them.
 * - `exts` (a Set of lower-case extensions) and `names` (a Set of base names)
 *   select files; with neither, every file is listed.
 */
export function walk(root, startRel, { exts, names, exclude = [], generated = false, dependencies = false, problems } = {}) {
  const start = join(root, startRel);
  if (!existsSync(start)) return [];
  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch {
    rootReal = resolve(root);
  }
  const prune = generated ? exclude : [...exclude, ...GENERATED_GLOBS];
  const prunedDirs = dependencies ? VCS_DIRS : DEPENDENCY_DIRS;
  const wanted = (name) => (!exts && !names) || exts?.has(extOf(name)) || names?.has(name);
  const visited = new Set();
  const out = [];
  const stack = [start];
  while (stack.length > 0) {
    const dir = stack.pop();
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(root, abs));
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        let target;
        let st;
        try {
          target = realpathSync(abs);
          st = statSync(abs);
        } catch {
          if (!matchesAny(rel, prune)) problems?.push({ file: rel, reason: 'is a dangling symlink' });
          continue;
        }
        if (!isInside(rootReal, target)) {
          if (!matchesAny(rel, prune)) problems?.push({ file: rel, reason: 'is a symlink that points outside the repo' });
          continue;
        }
        isDir = st.isDirectory();
        isFile = st.isFile();
      }
      if (isDir) {
        if (prunedDirs.has(entry.name)) continue;
        if (matchesAny(`${rel}/`, prune)) continue;
        stack.push(abs);
      } else if (isFile) {
        if (!wanted(entry.name)) continue;
        if (matchesAny(rel, prune)) continue;
        out.push(rel);
      }
    }
  }
  return out.sort();
}

/** Returns file text, or null for binary or oversized files. Gates that must fail closed use readForScan. */
export function readText(absPath) {
  let size;
  try {
    size = statSync(absPath).size;
  } catch {
    return null;
  }
  if (size > MAX_SCAN_BYTES) return null;
  const buf = readFileSync(absPath);
  if (buf.subarray(0, 8000).includes(0)) return null;
  return buf.toString('utf8');
}

/** Printable ASCII view of binary data; everything else becomes a line break. */
export function printableStrings(buf) {
  return buf.toString('latin1').replace(/[^\x20-\x7e]+/g, '\n');
}

/**
 * Classifies file content for a gate that must not skip anything silently:
 *   { kind: 'text', text }
 *   { kind: 'nul', text }     NUL bytes present; text has them removed so it can still be scanned
 *   { kind: 'bplist', text }  binary property list; text holds its printable strings
 */
export function classifyBuffer(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).toString('latin1') === 'bplist00') {
    return { kind: 'bplist', text: printableStrings(buf) };
  }
  if (buf.includes(0)) return { kind: 'nul', text: buf.toString('utf8').replace(/\u0000/g, '') };
  return { kind: 'text', text: buf.toString('utf8') };
}

/** Like classifyBuffer, plus { kind: 'too-large', size } and { kind: 'error', reason }. */
export function readForScan(absPath) {
  let size;
  try {
    size = statSync(absPath).size;
  } catch (err) {
    return { kind: 'error', reason: err?.code ?? 'unreadable' };
  }
  if (size > MAX_SCAN_BYTES) return { kind: 'too-large', size };
  try {
    return classifyBuffer(readFileSync(absPath));
  } catch (err) {
    return { kind: 'error', reason: err?.code ?? 'unreadable' };
  }
}

/**
 * Test sources and recorded test data:
 *   - *.test.* and *.spec.* files
 *   - anything in a __tests__/ directory (packages/x/src/__tests__ included)
 *   - anything in an e2e/ or fixtures/ directory that is not under a src/ tree
 * A fixtures/ or e2e/ folder inside src/ is shipped code: bundlers inline it.
 */
export function isTestPath(relPath) {
  if (/\.(?:test|spec)\.[A-Za-z0-9]+$/.test(basename(relPath))) return true;
  const dirs = relPath.split('/').slice(0, -1);
  const srcAt = dirs.indexOf('src');
  return dirs.some(
    (d, i) => d === '__tests__' || ((d === 'e2e' || d === 'fixtures') && (srcAt < 0 || i < srcAt)),
  );
}

export function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** 1-based line and column for a character offset. */
export function positionAt(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: index - starts[lo] + 1 };
}

export function lineAt(text, starts, line) {
  const begin = starts[line - 1] ?? 0;
  const next = starts[line];
  const end = next === undefined ? text.length : next - 1;
  return text.slice(begin, end);
}

export function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(resolve(entry)).href === importMetaUrl;
}

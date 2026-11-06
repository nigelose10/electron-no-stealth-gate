import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BUILD_OUTPUT_GLOBS, REPO_ROOT, matchesAny } from '../lib/files.mjs';
import { readAsar, writeAsar } from './asar.mjs';
import { normalize } from './normalize.mjs';
import {
  collectBuiltFiles,
  collectFiles,
  normalizeConcatenation,
  runStealthGate,
  scanBuffer,
  scanText,
} from './stealth-gate.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtureText = (rel) => readFileSync(join(FIXTURES, rel), 'utf8');
const CASES = JSON.parse(fixtureText('cases.json'));

function scanFixtures(dirs) {
  return runStealthGate({ root: FIXTURES, dirs, exclude: [] });
}

function rulesByFile(findings) {
  const out = {};
  for (const f of findings) {
    out[f.file] ??= {};
    out[f.file][f.rule] = (out[f.file][f.rule] ?? 0) + 1;
  }
  return out;
}

const countRules = (findings) => rulesByFile(findings.map((f) => ({ ...f, file: 'x' }))).x ?? {};

/** Builds a throwaway repo from a cases.json spec; returns its root. */
function makeRepo(spec) {
  const root = mkdtempSync(join(tmpdir(), 'geek-stealth-repo-'));
  const put = (rel, data) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  };
  for (const [rel, text] of Object.entries(spec.files ?? {})) put(rel, text);
  for (const [rel, text] of Object.entries(spec.nul ?? {})) put(rel, Buffer.from(text, 'utf8'));
  for (const [rel, text] of Object.entries(spec.bplist ?? {})) put(rel, Buffer.from(text, 'latin1'));
  for (const [rel, text] of Object.entries(spec.binary ?? {})) put(rel, Buffer.from(text, 'latin1'));
  for (const asar of [spec.asar, ...(spec.asars ?? [])].filter(Boolean)) put(asar.path, writeAsar(asar.entries));
  for (const [link, target] of Object.entries(spec.symlinks ?? {})) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(relative(dirname(join(root, link)), join(root, target)), join(root, link));
  }
  const outside = mkdtempSync(join(tmpdir(), 'geek-stealth-outside-'));
  writeFileSync(join(outside, 'elsewhere.ts'), 'export const elsewhere = 1;\n');
  for (const link of spec.outsideSymlinks ?? []) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(outside, 'elsewhere.ts'), join(root, link));
  }
  return {
    root,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    },
  };
}

test('every bad fixture is flagged with the expected rules', () => {
  const { findings } = scanFixtures(['bad']);
  assert.deepEqual(rulesByFile(findings), {
    'bad/Info.plist': { 'dock-hide': 1 },
    'bad/__tests__/window.ts': { 'skip-taskbar': 1 },
    'bad/builder.yml': { 'dock-hide': 1 },
    'bad/capture.cc': { 'capture-exclusion': 2 },
    'bad/capture.mm': { 'sharing-type': 2 },
    'bad/copy.tsx': { 'copy-detection-claim': 1, 'copy-invisibility-claim': 1 },
    'bad/eclass.ts': { 'quiz-attempt': 3, 'eclass-write': 3, 'eclass-autologin': 1, 'crowdmark-api': 1 },
    'bad/evasion.ts': { 'content-protection': 2, 'skip-taskbar': 2, 'mission-control': 1 },
    'bad/implicit-dock.ts': { 'implicit-dock-hide': 1 },
    'bad/moodle.ts': { 'moodle-mobile-ua': 1, 'moodle-default-handler': 1 },
    'bad/window-apis.ts': {
      'content-protection': 1,
      'mission-control': 2,
      'skip-taskbar': 1,
      'dock-hide': 4,
      'tool-window': 3,
    },
  });
});

test('clean fixtures pass: moodlemobile capture code, the Dock-safe overlay and the live site integrity copy', () => {
  const { findings, scanned } = scanFixtures(['clean']);
  assert.deepEqual(findings, []);
  assert.equal(scanned, 5);
});

test('split identifiers are caught on the line where they start', () => {
  const { findings } = scanFixtures(['bad']);
  const evasion = findings
    .filter((f) => f.file === 'bad/evasion.ts')
    .map((f) => [f.line, f.rule, f.message.includes('after joining split string fragments')]);
  assert.deepEqual(evasion, [
    [2, 'content-protection', true],
    [3, 'skip-taskbar', true],
    [6, 'mission-control', true],
    [7, 'skip-taskbar', false],
    [8, 'content-protection', true],
  ]);
});

test('data patterns (eClass names, the Moodle app user agent, copy) are allowed only in test paths', () => {
  const eclass = fixtureText('bad/eclass.ts');
  const copy = fixtureText('bad/copy.tsx');
  const moodle = fixtureText('bad/moodle.ts');
  assert.equal(scanText('packages/eclass-client/src/allowlist.ts', eclass).length, 8);
  assert.equal(scanText('packages/eclass-client/src/allowlist.test.ts', eclass).length, 0);
  assert.equal(scanText('packages/eclass-client/src/__tests__/never-list.ts', eclass).length, 0);
  assert.equal(scanText('packages/eclass-client/fixtures/site_info.json', eclass).length, 0);
  assert.equal(scanText('apps/desktop/e2e/copy.spec.ts', copy).length, 0);
  assert.equal(scanText('apps/desktop/src/renderer/copy.tsx', copy).length, 2);
  const inTest = scanText('packages/eclass-client/src/client.test.ts', moodle).map((f) => f.rule);
  assert.deepEqual(inTest, ['moodle-default-handler'], 'the system-wide handler call stays banned in tests');
});

test('fixtures/ and e2e/ folders inside src/ are shipped code, not test paths', () => {
  const eclass = fixtureText('bad/eclass.ts');
  assert.equal(scanText('packages/eclass-client/src/fixtures/fns.ts', eclass).length, 8);
  assert.equal(scanText('packages/eclass-client/src/e2e/fns.ts', eclass).length, 8);
  assert.equal(scanText('apps/desktop/src/main/__fixtures__/fns.ts', eclass).length, 8);
});

test('built output gets no test-path relaxation', () => {
  const eclass = fixtureText('bad/eclass.ts');
  assert.equal(scanText('apps/desktop/out/renderer/__tests__/x.js', eclass).length, 0);
  assert.equal(scanText('apps/desktop/out/renderer/__tests__/x.js', eclass, { shipped: true }).length, 8);
});

test('window stealth APIs stay banned inside test files', () => {
  const windows = fixtureText('bad/window-apis.ts');
  assert.equal(scanText('apps/desktop/src/main/windows.test.ts', windows).length, 11);
});

const RULES_UNDER_TEST = [
  'non-focusable',
  'skip-taskbar',
  'dock-hide',
  'tool-window',
  'capture-exclusion',
  'mission-control',
  'content-protection',
  'implicit-dock-hide',
  'moodle-default-handler',
  'default-protocol-client',
  'moodle-mobile-ua',
  'moodle-scheme-config',
  'quiz-attempt',
  'eclass-write',
  'copy-stealth-claim',
  'copy-invisibility-claim',
  'copy-detection-claim',
  'copy-cheating-claim',
];

test('every rule under test has at least one firing and one passing case', () => {
  for (const rule of RULES_UNDER_TEST) {
    const mine = CASES.cases.filter((c) => c.rule === rule);
    assert.ok(mine.some((c) => (c.expect[rule] ?? 0) > 0), `${rule} has no firing case`);
    assert.ok(mine.some((c) => Object.keys(c.expect).length === 0), `${rule} has no passing case`);
  }
});

for (const [i, c] of CASES.cases.entries()) {
  const verdict = Object.keys(c.expect).length === 0 ? 'passes' : 'fires';
  test(`case ${i + 1}: ${c.rule} ${verdict} (${c.path})`, () => {
    assert.deepEqual(countRules(scanText(c.path, c.text)), c.expect, c.text);
  });
}

test('source mode scans the whole repo, prunes build output only at its anchored roots, and fails closed', () => {
  const spec = CASES.sourceRepo;
  const { root, cleanup } = makeRepo(spec);
  try {
    const result = runStealthGate({ root });
    assert.deepEqual(rulesByFile(result.findings), spec.expect);
    const files = collectFiles({ root });
    for (const pruned of ['apps/desktop/out/main/app.js', 'apps/desktop/release/mac/app.js', 'coverage/lcov-report/app.js', 'spikes/out/S1-result.json']) {
      assert.ok(!files.includes(pruned), `${pruned} is generated output`);
    }
    for (const kept of ['apps/desktop/src/main/release/channel.ts', 'apps/desktop/src/main/out/x.ts', 'apps/desktop/src/main/clean.ts', 'package.json', '.github/workflows/release.yml']) {
      assert.ok(files.includes(kept), `${kept} must be scanned`);
    }
  } finally {
    cleanup();
  }
});

test('built mode scans what ships: out/, dist/, the packaged app.asar, its unpacked native modules and Info.plist', () => {
  const spec = CASES.builtRepo;
  const { root, cleanup } = makeRepo(spec);
  try {
    const built = runStealthGate({ root, mode: 'built' });
    assert.deepEqual(rulesByFile(built.findings), spec.expect);
    const { roots, files } = collectBuiltFiles({ root });
    assert.deepEqual(roots, ['apps/desktop/out', 'apps/desktop/release', 'packages/contracts/dist']);
    assert.ok(!files.some((f) => f.includes('/Frameworks/')), "Electron helper apps carry Electron's own Info.plist");
    assert.ok(!files.some((f) => f.endsWith('LICENSES.chromium.html')), 'Electron framework files are not scanned');
    assert.match(built.notes[0], /known binary assets \(images, fonts\) skipped: 1$/);
    assert.deepEqual(runStealthGate({ root }).findings, [], 'source mode leaves build output to the built pass');
  } finally {
    cleanup();
  }
});

test('built mode reads node_modules that ship: app.asar.unpacked native modules, asar contents and the macOS Resources layout', () => {
  const spec = CASES.packagedRepo;
  const { root, cleanup } = makeRepo(spec);
  try {
    const built = runStealthGate({ root, mode: 'built' });
    assert.deepEqual(rulesByFile(built.findings), spec.expect);
    const { roots, files } = collectBuiltFiles({ root });
    assert.deepEqual(roots, ['apps/desktop/release', 'apps/site/.vercel/output']);
    for (const shipped of [
      'apps/desktop/release/linux-unpacked/resources/app.asar',
      'apps/desktop/release/linux-unpacked/resources/app.asar.unpacked/node_modules/@libsql/linux-x64-gnu/index.node',
      'apps/desktop/release/linux-unpacked/resources/app.asar.unpacked/node_modules/@libsql/linux-x64-gnu/package.json',
      'apps/desktop/release/mac/Geek.app/Contents/Resources/app.asar',
      'apps/desktop/release/mac/Geek.app/Contents/Resources/app.asar.unpacked/node_modules/native-helper/build/Release/helper.node',
    ]) {
      assert.ok(files.includes(shipped), `${shipped} ships and must be scanned`);
    }
    assert.ok(!files.some((f) => f.startsWith('node_modules/') || f.startsWith('apps/desktop/node_modules/')), 'dependency folders outside build output are not build output');
    assert.match(built.notes[0], /known binary assets \(images, fonts\) skipped: 1$/);
    assert.match(built.notes[1], /native modules \(\.node\) scanned for printable strings: 3$/);
    const source = runStealthGate({ root });
    assert.deepEqual(source.findings, [], 'source mode still skips every node_modules folder and leaves build output to the built pass');
    assert.ok(collectFiles({ root }).every((f) => !/(^|\/)node_modules\//.test(f)));
  } finally {
    cleanup();
  }
});

test('an asar entry marked unpacked fails the built pass when its file is not on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'geek-stealth-unpacked-'));
  try {
    const asar = 'apps/desktop/release/linux-unpacked/resources/app.asar';
    mkdirSync(dirname(join(root, asar)), { recursive: true });
    writeFileSync(join(root, asar), writeAsar({ 'package.json': '{}', 'node_modules/n/index.node': { unpacked: true } }));
    const { findings } = runStealthGate({ root, mode: 'built' });
    assert.deepEqual(
      findings.map((f) => [f.file, f.rule]),
      [[`${asar}/node_modules/n/index.node`, 'unscannable']],
    );
    assert.match(findings[0].message, /marked unpacked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('built mode fails when there is no build output', () => {
  const root = mkdtempSync(join(tmpdir(), 'geek-stealth-empty-'));
  try {
    mkdirSync(join(root, 'apps', 'desktop', 'src'), { recursive: true });
    const { findings } = runStealthGate({ root, mode: 'built' });
    assert.deepEqual(findings.map((f) => f.rule), ['no-build-output']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NUL bytes and binary plists are reported, and their readable content is still scanned', () => {
  const nul = scanBuffer('apps/desktop/src/main/a.ts', Buffer.from(CASES.sourceRepo.nul['apps/desktop/src/main/nul.ts'], 'utf8'));
  assert.deepEqual(countRules(nul.findings), { unscannable: 1, 'content-protection': 1 });
  const utf16 = scanBuffer('apps/desktop/src/main/b.ts', Buffer.from(CASES.sourceRepo.files['apps/desktop/src/main/release/channel.ts'], 'utf16le'));
  assert.deepEqual(countRules(utf16.findings), { unscannable: 1, 'content-protection': 1 }, 'UTF-16 text is read through');
  const plist = scanBuffer('build/Info.plist', Buffer.from(CASES.sourceRepo.bplist['apps/desktop/build/Info.plist'], 'latin1'));
  assert.deepEqual(countRules(plist.findings), { 'needs-review': 1, 'dock-hide': 1 });
  const clean = scanBuffer('build/clean.plist', Buffer.from('bplist00\u0000\u0001', 'latin1'));
  assert.deepEqual(countRules(clean.findings), { 'needs-review': 1 }, 'a binary plist always needs review');
  for (const asset of ['a.png', 'a.jpg', 'a.gif', 'a.webp', 'a.woff', 'a.woff2', 'a.ttf', 'a.otf', 'a.ico', 'a.icns']) {
    assert.deepEqual(scanBuffer(asset, Buffer.from([0, 1, 2])), { findings: [], skipped: true }, asset);
  }
});

test('asar archives round-trip and malformed ones throw', () => {
  const files = readAsar(writeAsar({ 'out/main/app.js': 'a', 'package.json': '{}', 'node_modules/n/index.node': { unpacked: true } }));
  assert.deepEqual(
    files.map((f) => [f.path, f.data?.toString() ?? (f.unpacked ? 'unpacked' : 'none')]),
    [
      ['out/main/app.js', 'a'],
      ['package.json', '{}'],
      ['node_modules/n/index.node', 'unpacked'],
    ],
  );
  assert.throws(() => readAsar(Buffer.from('not an archive at all')), /asar/);
});

test('normalization keeps line counts and handles template, const and escape forms', () => {
  const src = "a = 'one' +\n  'two' + \"three\";\nb = ['x', 'y', `z`].join('');\nc = 'keep' + other;";
  const out = normalizeConcatenation(src);
  assert.ok(out.includes("'onetwothree'"));
  assert.ok(out.includes("'xyz'"));
  assert.ok(out.includes("'keep' + other"));
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.equal(normalize('const a = `x${"y"}z`;'), 'const a = `xyz`;');
  assert.equal(normalize("const k = 'ab';\nf(k + 'c');", { js: true }), "const k = 'ab';\nf('abc');");
  assert.equal(normalize("let k = 'ab';\nf(k);", { js: true }), "let k = 'ab';\nf(k);", 'let can be reassigned, so it is never resolved');
  assert.equal(normalize("const k = 'a';\nconst k = 'b';\nf(k);", { js: true }).split('\n')[2], 'f(k);', 'ambiguous consts stay unresolved');
  assert.equal(normalize("'\\x41\\u0042\\u{43}'"), "'ABC'");
  assert.equal(normalize("'\\x27'"), "'\\x27'", 'escapes that would change the string structure stay encoded');
});

test('findings carry file, line and column', () => {
  const [first] = scanFixtures(['bad']).findings.filter((f) => f.file === 'bad/moodle.ts');
  assert.equal(first.line, 2);
  assert.equal(first.col, 21);
});

test('real scan covers the repo root, .github and the gate itself, and skips fixtures, the pattern list and build output', () => {
  const files = collectFiles({ root: REPO_ROOT });
  assert.ok(files.every((f) => !/^tools\/[^/]+\/fixtures\//.test(f)), 'fixtures must be excluded');
  assert.ok(!files.includes('tools/stealth-gate/patterns.mjs'));
  for (const f of ['tools/stealth-gate/stealth-gate.mjs', 'tools/stealth-gate/stealth-gate.test.mjs', 'package.json', 'pnpm-workspace.yaml', '.github/workflows/ci.yml']) {
    assert.ok(files.includes(f), `${f} must be scanned`);
  }
  assert.ok(files.every((f) => !/(^|\/)node_modules\//.test(f)));
  assert.ok(files.every((f) => !matchesAny(f, BUILD_OUTPUT_GLOBS)), 'build output is left to the --built pass');
  assert.ok(files.every((f) => !f.endsWith('.md')));
});

test('the gates and their tests contain no banned strings', () => {
  const own = collectFiles({ root: REPO_ROOT, dirs: ['tools'] });
  const findings = own.flatMap((rel) => scanText(rel, readFileSync(join(REPO_ROOT, rel), 'utf8')));
  assert.deepEqual(findings, []);
});

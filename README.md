# Stealth gate

Fails CI on anything that would keep Geek out of screen capture, the taskbar, the Dock or Mission Control, pose as the Moodle app, register the Moodle app's URL scheme system-wide, call eClass write or quiz-attempt functions, or claim any of that in copy (plan 4.2 invariants 3 and 4, plan 7.1, 7.2, 7.5 and 11.5, ADR 0002 and 0005).

```bash
node tools/run-gates.mjs stealth      # source mode (part of `corepack pnpm gates`)
corepack pnpm gates:built             # built mode, after `corepack pnpm --filter @geek/desktop build`
node --test tools                     # the gate's own tests
```

This version catches all of the M0 review's probe set (55 bypass attempts) except prototype reflection, which is listed under "Out of scope", and every planted file in its fake repo.

Files: `patterns.mjs` holds every banned string and regex (the only file the gate skips besides `tools/*/fixtures/**`), `normalize.mjs` rewrites indirect spellings, `copy-claims.mjs` is the copy heuristic, `asar.mjs` reads packaged archives, and `fixtures/cases.json` is the table of firing and passing cases the tests run.

## Two modes

**Source mode** (default, CI `checks` job) walks the whole repo: the root, `.github/`, `apps/`, `packages/`, `spikes/`, `tools/`, `scripts/`, `patches/`, `build/`, everything. It skips:

- `node_modules/` and `.git/` at any depth;
- build output only at its anchored roots: `apps/*/out`, `apps/*/dist`, `apps/*/release`, `apps/*/.vercel/output`, `packages/*/dist`, plus `coverage/` at the root and in each app or package, and `spikes/out/` (gitignored spike results). A folder named `out`, `dist`, `release` or `coverage` anywhere else, such as `src/main/release/`, is scanned;
- `.md` files (docs describe the banned APIs on purpose);
- `tools/*/fixtures/**` and `patterns.mjs`.

Scanned file types: JS and TS family, `.svelte`, `.vue`, `.astro`, `.mdx`, JSON, JSON5, JSONC, TOML, YAML, XML, plist, `.entitlements`, `.ini`, `.desktop`, `.reg`, HTML, CSS, installer scripts (`.nsh`, `.nsi`, `.iss`), `.patch` and `.diff`, native sources (Swift, Objective-C, C, C++, Rust, C#, Go, Java, Kotlin) and shell or script files (`.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.psm1`, `.bat`, `.cmd`, `.vbs`, `.applescript`, `.py`), plus `.npmrc`, `.yarnrc`, `.editorconfig`, `.gitattributes`, `.nvmrc`, `.node-version`, `.env.example`, `CODEOWNERS`, `Dockerfile`, `Makefile` and `Procfile` by name.

**Built mode** (`--built`, CI `renderer-build` job after `dist:linux:dir`) scans what ships: every file under `apps/*/out`, `apps/*/dist`, `apps/*/.vercel/output` and `packages/*/dist`, and inside `apps/*/release` only the app's own packaged resources: `resources/app.asar` (each entry is read, its `node_modules` included), `resources/app.asar.unpacked/`, `resources/app/`, the top-level `*.app/Contents/Info.plist`, `.nsh`, `.nsi` and `.desktop` files and `builder-effective-config.yaml` / `builder-debug.yml`. The resources folder is `resources/` on Windows and Linux and `Geek.app/Contents/Resources/` on macOS; both are matched. Unlike source mode, built mode does not skip `node_modules`: inside build output they ship, and `app.asar.unpacked/node_modules` holds the native modules (`asarUnpack`, for example libsql's `index.node`). Every `app.asar` entry marked unpacked must be found on disk next to the archive, or it is reported `unscannable`. Electron's framework files and helper apps under `Frameworks/` are not ours and are skipped. Every built file counts as shipped, so test-path relaxations do not apply. Built mode fails with `no-build-output` when none of these roots exists.

## Failing closed

Nothing is skipped silently:

| Rule | When |
|---|---|
| `unscannable` | a scanned file contains NUL bytes (its readable text, with NULs removed, is still scanned, so UTF-16 text is caught too), is over 32 MB, cannot be read, is an unreadable asar, is an `app.asar` entry marked unpacked whose file the built scan did not find, or is a symlink that dangles or points outside the repo |
| `needs-review` | a binary property list (`bplist00`); its printable strings are still scanned. Commit plists as XML (`plutil -convert xml1`) |
| `no-build-output` | `--built` found nothing to scan |

Known binary assets (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.ico`, `.icns`) are skipped and counted in the built-mode note. Native modules (`.node`, in `app.asar` or `app.asar.unpacked`) are binary too, but their printable ASCII strings are scanned for the API and data rules, since an imported `SetWindowDisplayAffinity` or an `LSUIElement` key shows up there by name; the built-mode note counts them. Symlinks that resolve inside the repo are followed once per real path.

## Rules

Scope `everywhere` applies to every scanned file, tests included. Scope `source` is data a validator must reject; it applies to shipped code and is relaxed in test paths.

| Rule | Scope | Catches |
|---|---|---|
| `content-protection` | everywhere | anything containing `ContentProtection` |
| `mission-control` | everywhere | `HiddenInMissionControl`, `NSWindowCollectionBehaviorTransient` / `IgnoresCycle`, Swift `collectionBehavior` with `.transient` or `.ignoresCycle` |
| `skip-taskbar` | everywhere | `skipTaskbar` in any case, GTK and X11 `skip_taskbar` / `skip_pager` hints (`gtk_window_set_skip_taskbar_hint`, `_NET_WM_STATE_SKIP_TASKBAR`), `ITaskbarList`, `DeleteTab(` |
| `non-focusable` | everywhere | `setFocusable(x)` unless `x` is a literal `true`; the `focusable` option or property with any value but `true`, `!0` or a quoted string. Electron's typings say `focusable: false` implies `skipTaskbar: true` on Windows. The option check skips renderer folders and `apps/site`, which cannot create windows and where Radix and SVG use a `focusable` prop of their own; `case "focusable":` labels are ignored |
| `dock-hide` | everywhere | `dock.hide`, `dock?.hide`, `dock['hide']`, same-file aliases of the Dock object, `LSUIElement`, `LSBackgroundOnly`, `setActivationPolicy(x)` unless `x` is `'regular'` (or Swift `.regular`), the Objective-C form with any policy but `NSApplicationActivationPolicyRegular`, `NSApplicationActivationPolicyAccessory` / `Prohibited`, `TransformProcessType`, `kProcessTransformToUIElementApplication` / `BackgroundApplication` |
| `tool-window` | everywhere | `setWindowToolWindow`, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, `GWL_EXSTYLE`, `DWMWA_EXCLUDED_FROM_PEEK`, `type: 'toolbar'` (quoted keys too) |
| `capture-exclusion` | everywhere | `WDA_EXCLUDEFROMCAPTURE`, `WDA_MONITOR`, `SetWindowDisplayAffinity`, `captureScreenshotExcluding`, `DWMWA_CLOAK` |
| `sharing-type` | everywhere | `sharingType`, `NSWindowSharingNone` |
| `implicit-dock-hide` | everywhere | per options object: a `visibleOnFullScreen` key (or `.visibleOnFullScreen =`, or the `{ visibleOnFullScreen }` shorthand) whose value is not a literal `false` must sit in an object literal that also says `skipTransformProcessType: true`. One compliant call no longer covers a second call, and a comment does not count |
| `moodle-default-handler` | everywhere | `setAsDefaultProtocolClient(...)` whose first argument resolves to the Moodle app's scheme (any quote style, template literal, concatenation or same-file const) |
| `default-protocol-client` | everywhere (not in comments) | `setAsDefaultProtocolClient(...)` whose first argument does not resolve to the literal `'geek'` (`ALLOWED_DEFAULT_SCHEMES`) |
| `moodle-scheme-config` | source, config files | any mention of the scheme in JSON, JSON5, TOML, YAML, XML, plist, `.entitlements`, `.ini`, `.desktop`, `.reg`, NSIS or Inno files (electron-builder `protocols`, `CFBundleURLSchemes`, registry entries) |
| `moodle-mobile-ua` | source | the Moodle app's user-agent token in any case (Moodle tests it with `stripos`). The all-lower-case scheme is allowed only as a token link (`moodlemobile://`, regex-escaped `:\/\/`, `url.protocol === 'moodlemobile:'`), in the capture regex alternation, listed together with `geekapp`, as the first argument of `protocol.handle` / `unhandle` / `isProtocolHandled`, or as the value of (or a comparison with) the `forcedurlscheme` field of Moodle's public config. A bare `'moodlemobile'` string or const is flagged: write it inline in `ses.protocol.handle(...)` |
| `quiz-attempt` | source | every `mod_quiz_*attempt*` function except `get_user_attempts` and `get_user_quiz_attempts`, `mod_*_(start\|launch\|process\|save\|finish)_attempt`, `mod_*_get_attempt_(data\|summary\|review)` |
| `eclass-write` | source | assignment save, submit, lock and reveal functions, message send, forum add, every `*_view_*` function (they log views and completion), `mod_*_process_page`, `core_user_agree_site_policy` |
| `eclass-autologin` | source | `tool_mobile_get_autologin_key`, `tool_mobile_get_tokens_for_qr_login` |
| `crowdmark-api` | source | `app.crowdmark.com/api` |
| `copy-detection-claim`, `copy-invisibility-claim`, `copy-stealth-claim`, `copy-cheating-claim` | source | the copy claims below |

**Test paths** (where `source` rules are relaxed): `*.test.*` and `*.spec.*` files, anything in a `__tests__/` folder (including `packages/*/src/__tests__`), and anything in an `e2e/` or `fixtures/` folder that is not under a `src/` tree. A `fixtures/` or `e2e/` folder inside `src/` is shipped code, because bundlers inline whatever shipped code imports. `__fixtures__` no longer counts. The built pass catches test data that shipped code imports anyway.

## Normalization

Before matching, `normalize.mjs` rewrites these spellings into the plain name, keeping line numbers:

- `\xXX`, `\uXXXX` and `\u{...}` escapes and `&#NN;` / `&#xNN;` character references (plist, XML, HTML) that decode to identifier-safe characters;
- `'a' + 'b'`, also with whitespace or comments around the `+`; `['a', 'b'].join('')`; `'a'.concat('b')`; `('a') + ('b')`;
- template literals whose `${}` parts are literals;
- `'cba'.split('').reverse().join('')`, `[...'cba'].reverse().join('')`, `String.fromCharCode(...)`;
- same-file `const NAME = 'literal'` values used as `win[NAME]`, `${NAME}`, `NAME + 'x'` or `f(NAME)` (JS-family files; `const` only, declared once);
- same-file aliases of the Dock object (`const d = app.dock`, `const { dock: d } = app`).

## Copy claims

The four copy rules read strings, JSX and HTML text and code, after normalization. In JS-family files they skip comments, including comments of code embedded in multi-line template literals (shader, CSS or SQL source), because comments are not copy. The two phrases the gate always checked, "undetectable" and "invisible to", still read comments in source mode.

Claims:

- detection: "undetectable", "undetected", "avoid / evade / escape / dodge detection" or a proctoring tool, "can't be detected / seen / recorded", "won't be caught", "never get caught", "without getting caught", "no one / no proctor will ever know";
- invisibility: "invisible", "invisibly", "invisibility", "hide / hidden from" proctors, teachers, screen shares, recordings, screenshots, Zoom, Teams, Meet or OBS, "won't show up in" any of those or the taskbar or Dock, "screen-share proof", "recording proof", "proctor proof";
- stealth: "stealth mode", "stealth overlay", "stealth window", "stealth feature", "stealthily", "in stealth", "ghost mode";
- cheating: "cheat", "cheats", "cheating", "cheater", and "bypass / beat / fool / trick / outsmart / circumvent / get around / get past" a proctor, LockDown, Respondus, Safe Exam Browser, Honorlock, Proctorio, an exam browser, the Integrity Lock or anti-cheat.

A claim is cleared, and not reported, when one of these holds:

1. **Its own clause negates it.** The clause runs back from the claim to the nearest `. ! ? ; : ,`, quote, bracket, `=` or `|` (at most 160 characters). It must contain one of: never, not, no, nor, without, won't, will not, don't, do not, doesn't, does not, isn't, is not, aren't, are not, wouldn't, refuses to. First these pseudo-negations are removed, because they are claims: "not just", "not only", "not even", "no longer", "no more", "no matter", "no one", "nobody", "nothing", "never been", "never before", "never again", "never get caught", "without getting caught". "can't" and "cannot" never count as negators: "proctors can't see it" is a claim. "non-", "no-" and "anti-" right before "stealth" or "cheat" count as negation.
2. **The nearest list heading above it is negated.** Integrity copy lists what Geek won't do under a heading such as "Geek won’t" or "What Geek will not do", with un-negated items ("Hide from screen sharing or recording"). Within 25 lines above the claim, the nearest heading-shaped phrase decides: a short phrase starting with Geek, We, It, This app, The app or The overlay plus a modal (will, won't, will not, never, does, doesn't, can't, is, isn't, always). A negated heading clears the claim; an affirmative one ("Geek will", "What Geek does") does not.
3. **"invisible" is a CSS class, not copy**: glued to selector or variant syntax (`.invisible`, `group-hover:invisible`, `invisible-x`) or in a phrase whose every token looks like a utility class (`"invisible absolute inset-0"`).

`fixtures/clean/site-integrity.tsx` holds sentences from the live site (`geek-v2-site/src`) that say what Geek does not do; they must pass. The whole site repo, including its build output, scanned with no findings when these rules were written (2026-10-10).

To write honest copy that passes: put the negation in the same clause ("Geek never hides from screen shares"), or list the items under a negated heading. "Cheat sheet" is flagged; say "formula sheet" or "study sheet".

## Out of scope

A regex-plus-normalization gate cannot see everything. These are known gaps, covered by the built pass, by code review and by the runtime checks the M0 review recommends (smoke asserts `!win.isContentProtected()`, `app.dock.isVisible()` after `setVisibleOnAllWorkspaces`, `app.isDefaultProtocolClient('moodlemobile') === false`, and an `assertHonestUserAgent()` on every `setUserAgent` and WS send), which live outside `tools/`:

- names built from runtime data, `let` or `var` values, values imported from another file, object property values (`opts.k`), function return values, `eval` and `new Function`;
- reflection: walking `BrowserWindow.prototype` or `Object.keys(win)` to find a method by suffix;
- base64, hex or other encodings (`atob`, `Buffer.from(..., 'base64')`), ROT13, and character arithmetic beyond `String.fromCharCode` with literal numbers;
- `const` values declared more than once in a file, or more than 400 consts in one file (resolution is skipped);
- Linux window types (`dock`, `desktop`, `splash`, `notification`) that some window managers keep out of the taskbar: the words collide with ordinary `type:` discriminants, and Linux is dev only;
- native code in compiled form other than `.node` printable ASCII strings: `.dll`, `.dylib`, `.so` and executables are not scanned for rules (inside packaged resources they contain NUL bytes and fail closed as `unscannable`; Electron's own binaries outside `resources/` are not read). Native APIs reached through function pointers or ordinals, UTF-16 wide strings, Swift strings short enough to be stored inline in code, and Objective-C selectors that only matter with a given argument (`setActivationPolicy:`) are invisible in a `.node` file;
- the allowed scheme spellings (`moodlemobile://`, scheme pairs with `geekapp`) could in theory be appended to a user agent; the runtime UA assertion is the real check;
- copy in other languages, in images or video, synonyms not listed above, and claims split across sentences ("Proctors look for overlays. Geek's isn't one of them.");
- copy-claim negation is lexical: "Geek never fails to hide from proctors" reads as negated.

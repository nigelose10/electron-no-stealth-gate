// Stealth gate pattern data (plan 4.2 invariant 4, 7.2, 7.5 and 11.5; ADR 0002).
// The gate excludes this file and tools/*/fixtures/** from real scans, so every
// banned string and every regex that names one lives here and nowhere else.
// README.md in this folder explains each rule and what stays out of scope.
//
// scope 'everywhere': window and process APIs. Banned in every scanned file,
//                     tests included; the gate itself is the check.
// scope 'source':     data a validator must reject (eClass function names, the
//                     MoodleMobile user agent, copy claims). Banned in shipped
//                     code, allowed in test paths (see isTestPath in
//                     tools/lib/files.mjs) so tests can prove the rejection.
//                     In --built mode every file counts as shipped.
// configOnly:         applies only to config-type files (CONFIG_EXTS, CONFIG_NAMES
//                     in stealth-gate.mjs).
// skipPaths:          a path regex the rule does not apply to.

export const PATTERNS = [
  {
    id: 'content-protection',
    scope: 'everywhere',
    re: /ContentProtection/gi,
    message: 'Content protection hides windows from capture and screen share (ADR 0002).',
  },
  {
    id: 'mission-control',
    scope: 'everywhere',
    re: /HiddenInMissionControl|NSWindowCollectionBehavior(?:Transient|IgnoresCycle)\b|collectionBehavior[^;\n]*\.(?:transient|ignoresCycle)\b/gi,
    message: 'Hiding from Mission Control or window cycling is a stealth feature (ADR 0002).',
  },
  {
    id: 'skip-taskbar',
    scope: 'everywhere',
    // skip_taskbar and skip_pager cover GTK (gtk_window_set_skip_taskbar_hint)
    // and X11 (_NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER).
    re: /skip_?taskbar|skip_?pager|ITaskbarList|\bDeleteTab\s*\(/gi,
    message: 'Every Geek window keeps its taskbar presence (ADR 0002).',
  },
  {
    id: 'non-focusable',
    scope: 'everywhere',
    // Electron 44 typings: "On Windows setting focusable: false also implies
    // setting skipTaskbar: true". setFocusable is a BrowserWindow method, so any
    // value but a literal true (or minified !0) is banned everywhere.
    re: /\bsetFocusable\s*\(\s*(?!(?:true|!0)\s*\))/g,
    message: 'A non-focusable window drops out of the Windows taskbar (Electron docs); keep focusable true (ADR 0002).',
  },
  {
    id: 'non-focusable',
    scope: 'everywhere',
    // The focusable option or property: anything but a literal true, !0 or a
    // quoted string (an SVG attribute) is banned. Renderer code is skipped: it
    // and the public site cannot create windows, and Radix and SVG use a
    // focusable prop of their own (README.md, "Window and process APIs").
    skipPaths: /(^|\/)renderer(?:-web)?\/|^apps\/site\//,
    re: /(?<!\bcase\s*['"`]?)\bfocusable(['"`]?)\s*:\s*(?!(?:true|!0)\b|['"`])(?=\S)|\.focusable\s*=(?![=>])\s*(?!(?:true|!0)\b)(?=\S)/g,
    message: 'A non-focusable window drops out of the Windows taskbar (Electron docs); keep focusable true (ADR 0002).',
  },
  {
    id: 'dock-hide',
    scope: 'everywhere',
    re: /\bdock\s*(?:\?\.|\.)\s*hide\b|\bdock\s*(?:\?\.)?\s*\[\s*['"`]hide['"`]\s*\]|\bLSUIElement\b|\bLSBackgroundOnly\b|\bsetActivationPolicy\s*\(\s*(?!['"`]regular['"`]\s*\)|\.regular\s*\)|NSApplicationActivationPolicyRegular\s*\))|\bsetActivationPolicy:\s*(?!NSApplicationActivationPolicyRegular\b)[A-Za-z_]\w*(?=\s*\])|NSApplicationActivationPolicy(?:Accessory|Prohibited)\b|kProcessTransformTo(?:UIElement|Background)Application|\bTransformProcessType\b/gi,
    message: 'Geek always keeps its Dock icon and a regular activation policy (ADR 0002).',
  },
  {
    id: 'tool-window',
    scope: 'everywhere',
    re: /setWindowToolWindow|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE|GWL_EXSTYLE|DWMWA_EXCLUDED_FROM_PEEK|(['"`]?)\btype\1\s*:\s*['"`]toolbar['"`]/gi,
    message: 'Tool and no-activate windows drop out of the taskbar and Alt+Tab (ADR 0002).',
  },
  {
    id: 'capture-exclusion',
    scope: 'everywhere',
    re: /WDA_EXCLUDEFROMCAPTURE|WDA_MONITOR|SetWindowDisplayAffinity|captureScreenshotExcluding|DWMWA_CLOAK\b/gi,
    message: 'Excluding or cloaking windows from capture is banned (ADR 0002).',
  },
  {
    id: 'sharing-type',
    scope: 'everywhere',
    re: /sharingType|NSWindowSharingNone/gi,
    message: 'NSWindow sharingType hides windows from capture (ADR 0002).',
  },
  {
    // Listed before moodle-mobile-ua so that, in config files, this rule names the finding.
    id: 'moodle-scheme-config',
    scope: 'source',
    configOnly: true,
    re: /moodlemobile/gi,
    message:
      'Config may never mention the moodlemobile scheme: electron-builder protocols, CFBundleURLSchemes or NSIS registry entries would register it system-wide (ADR 0005).',
  },
  {
    id: 'moodle-mobile-ua',
    scope: 'source',
    // Case-insensitive because Moodle's core_useragent::is_moodle_app() is
    // stripos($ua, 'MoodleMobile'). The scheme forms in MOODLE_SCHEME_AFTER and
    // MOODLE_SCHEME_BEFORE (capture regex, protocol.handle) are exempt.
    re: /moodlemobile/gi,
    allow: 'moodle-scheme',
    message:
      'Geek uses an honest Geek/x.y user agent and never poses as the Moodle app. Write the scheme only as a moodlemobile:// URL or inside protocol.handle(...) on the eClass partition (ADR 0005).',
  },
  {
    id: 'quiz-attempt',
    scope: 'source',
    re: /\bmod_quiz_(?!get_quizzes_by_courses\b|get_user_attempts\b|get_user_quiz_attempts\b)\w*attempt\w*|\bmod_\w+?_(?:start|launch|process|save|finish)_attempt\w*|\bmod_\w+?_get_attempt_(?:data|summary|review)\w*/gi,
    message: 'Quiz attempt functions, including attempt data, summary and review reads, can never be called (invariant 3).',
  },
  {
    id: 'eclass-write',
    scope: 'source',
    re: /\bmod_assign_(?:save_submission|submit_for_grading|submit_grading_form|lock_submissions|reveal_identities)|\bcore_message_send_(?:instant_messages|messages_to_conversation)|\bmod_forum_add_discussion|\b(?:mod|core|tool|gradereport|block|report|message|enrol)_\w*?_view_\w+|\bmod_\w+?_process_page\b|\bcore_user_agree_site_policy\b/gi,
    message: 'eClass access is read-only; write and *_view_* (completion logging) functions are never allowlisted (invariant 3).',
  },
  {
    id: 'eclass-autologin',
    scope: 'source',
    re: /tool_mobile_get_autologin_key|tool_mobile_get_tokens_for_qr_login/gi,
    message: 'Auto-login and QR token functions are never allowlisted (plan 7.2).',
  },
  {
    id: 'crowdmark-api',
    scope: 'source',
    re: /app\.crowdmark\.com\/api/gi,
    message: 'Crowdmark terms ban automated access; gradebook only (plan 7.5).',
  },
];

// Where moodlemobile is legitimate: the scheme of a token link (moodlemobile://,
// regex-escaped moodlemobile:\/\/, url.protocol 'moodlemobile:'), the scheme
// alternation of the capture regex ((moodlemobile|geekapp):\/\/), the pair of
// capture schemes listed together with geekapp (['moodlemobile', 'geekapp'],
// moodlemobile|geekapp, moodlemobile/geekapp), the first argument of
// protocol.handle / unhandle / isProtocolHandled, and the value of the
// forcedurlscheme field of Moodle's public config.
export const MOODLE_SCHEME_AFTER = [
  /^moodlemobile(?::\/\/|:\\\/\\\/|:['"`])/,
  /^moodlemobile(?:\|[\w-]+)*\)?:(?:\/\/|\\\/\\\/)/,
  /^moodlemobile['"`]?\s*[|,/]\s*['"`]?geekapp\b/,
];
export const MOODLE_SCHEME_BEFORE = [
  /\bprotocol\s*\.\s*(?:handle|unhandle|isProtocolHandled)\s*\(\s*['"`]$/,
  /\bgeekapp['"`]?\s*[|,/]\s*['"`]?$/,
  // A comparison with York's public-config field (preflight, canary). Assigning the
  // value is not exempt: config objects that carry it belong in fixtures/.
  /\bforcedurlscheme['"`]?\s*[!=]==\s*['"`]$/i,
];

// app.setAsDefaultProtocolClient(scheme) registers an OS-wide handler. Only
// Geek's own scheme may be registered; the first argument must resolve (after
// normalization and same-file const resolution) to one of these literals.
export const DEFAULT_PROTOCOL_CALL = /\bsetAsDefaultProtocolClient\s*\(/g;
export const ALLOWED_DEFAULT_SCHEMES = new Set(['geek']);
export const MOODLE_SCHEME = /moodle[\s_-]*mobile/i;
export const DEFAULT_PROTOCOL = {
  moodle: {
    id: 'moodle-default-handler',
    message: 'The moodlemobile scheme is handled only on the eClass partition, never system-wide (ADR 0005).',
  },
  other: {
    id: 'default-protocol-client',
    message: "Only Geek's own scheme may be registered system-wide; pass the literal 'geek' (plan 7.1).",
  },
};

// setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true }) transforms the
// macOS process type and hides the Dock icon unless skipTransformProcessType is
// set (Electron 44 typings, VisibleOnAllWorkspacesOptions). Checked per object
// literal: every visibleOnFullScreen key whose value is not a literal false must
// sit in an object that also says skipTransformProcessType: true.
export const IMPLICIT_DOCK_HIDE = {
  id: 'implicit-dock-hide',
  scope: 'everywhere',
  key: /(?<![\w$.])(['"`]?)visibleOnFullScreen\1\s*(?::\s*([^,}\n]*)|(?=[,}]|\s+[,}]))|\.visibleOnFullScreen\s*=(?![=>])\s*([^;,\n}]*)/g,
  off: /^\s*(?:false|!1|0)\s*$/,
  guard: /(['"`]?)skipTransformProcessType\1\s*:\s*(?:true|!0)\b/,
  message:
    'visibleOnFullScreen without skipTransformProcessType: true in the same options object turns Geek into a UI element app and hides its Dock icon (ADR 0002).',
};

// Same-file aliases of the Dock object (const d = app.dock; const { dock: d } = app)
// are rewritten to `dock` before matching, so d.hide() is caught.
export const DOCK_ALIAS_DECL = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.?]*\bdock\b(?![\w$(])/g;
export const DOCK_ALIAS_DESTRUCTURE = /\{[^{}]*?\bdock\s*:\s*([A-Za-z_$][\w$]*)[^{}]*\}\s*=/g;
export const dockAliasUse = (name) =>
  new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?=\\s*(?:\\?\\.|\\.)\\s*hide\\b|\\s*(?:\\?\\.)?\\s*\\[)`, 'g');
export const DOCK_WORD = 'dock';

// ---------------------------------------------------------------------------
// Copy claims (scope 'source'). README.md, "Copy claims", explains the heuristic.
// They read strings, JSX text and code, not JS comments (comments are not copy).
// LEGACY_COMMENT_CLAIMS, the two phrases the gate checked before, keep reading
// comments too in source mode, so the older check never got weaker.
export const LEGACY_COMMENT_CLAIMS = /\bundetectable\b|\binvisible\s+to\b/i;

const WATCHERS = String.raw`(?:proctor\w*|invigilator\w*|teacher\w*|instructor\w*|professor\w*|tas?\b|screen[\s-]?(?:shar\w*|record\w*|captur\w*)|recording\w*|screenshot\w*|zoom|teams|meet|obs\b|capture\w*)`;
const EXAM_LOCKS = String.raw`(?:proctor\w*|lockdown\w*|respondus|safe\s+exam\s+browser|honorlock|proctorio|exam\s+browser\w*|integrity\s+lock|anti[\s-]?cheat\w*)`;
const CAUGHT = String.raw`(?:caught|detected|noticed|flagged|spotted|tracked|recorded|captured|seen)`;
const NOT = String.raw`(?:never|not|won[’']?t|don[’']?t|doesn[’']?t|will\s+not|does\s+not)`;

export const COPY_CLAIMS = [
  {
    id: 'copy-detection-claim',
    re: new RegExp(
      [
        String.raw`\bundetect(?:able|ably|ed)\b`,
        String.raw`\b(?:avoid|evad|escap|dodg)(?:e|es|ed|ing|s)?\s+(?:all\s+|any\s+)?(?:detection|${EXAM_LOCKS})`,
        String.raw`\b(?:can(?:not|[’']t|\s+not)|won[’']?t|will\s+not)\s+(?:ever\s+)?be\s+${CAUGHT}\b`,
        String.raw`\b${NOT}\s+(?:ever\s+)?(?:get|getting|be|being)\s+${CAUGHT}\b`,
        String.raw`\bwithout\s+(?:ever\s+)?(?:getting\s+|being\s+)?${CAUGHT}\b`,
        String.raw`\b(?:no\s*one|nobody|no\s+(?:proctor|teacher|instructor|professor|invigilator|ta))\s+(?:will|can|could|would)\s+(?:ever\s+)?(?:know|tell|see|notice|detect|find\s+out)\b`,
      ].join('|'),
      'gi',
    ),
    message: 'Never claim Geek cannot be detected.',
  },
  {
    id: 'copy-invisibility-claim',
    re: new RegExp(
      [
        String.raw`\binvisib(?:le|ly|ility)\b(?:\s+to\b)?`,
        String.raw`\bhid(?:e|es|den|ing)\s+(?:it\s+|itself\s+|you\s+|geek\s+|the\s+(?:app|overlay|window)\s+)?from\s+(?:the\s+|your\s+|any\s+|all\s+)?${WATCHERS}`,
        String.raw`\b${NOT}\s+(?:show|appear)s?\s+(?:up\s+)?(?:in|on)\s+(?:the\s+|your\s+|any\s+)?(?:${WATCHERS}|taskbar|dock)`,
        String.raw`\b(?:screen[\s-]?shar(?:e|ing)|screen[\s-]?record(?:ing|er)?|recording|capture|proctor(?:ing)?|screenshot)[\s-]?proof\b`,
      ].join('|'),
      'gi',
    ),
    // `invisible` is also a CSS utility class; see CLASS_LIKE_* below.
    classLike: /^invisib/i,
    message: 'Never claim Geek is hidden from anyone; it stays visible in shares and recordings.',
  },
  {
    id: 'copy-stealth-claim',
    re: /(?<!\b(?:non|no|anti)[\s-]?)\bstealth(?:[\s_-]?(?:mode|modes|overlay|window|windows|feature|features|setting|settings)\b|ily\b|y\b)|\bin\s+stealth\b|\bghost\s+mode\b/gi,
    message: 'Geek has no stealth mode, and copy never offers one.',
  },
  {
    id: 'copy-cheating-claim',
    re: new RegExp(
      [
        String.raw`(?<!\b(?:anti|non|no)[\s-]?)\bcheat(?:s|ed|ing|er|ers)?\b`,
        String.raw`\b(?:bypass|beat|fool|trick|outsmart|circumvent|get\s+around|get\s+past)(?:es|s|ed|ing)?\s+(?:the\s+|any\s+|your\s+|all\s+)?${EXAM_LOCKS}`,
      ].join('|'),
      'gi',
    ),
    message: 'Never pitch Geek as a way to cheat or to get past proctoring or the Integrity Lock.',
  },
];

// A claim is negated when its clause (text back to the nearest CLAUSE_BREAK,
// at most CLAUSE_MAX characters) contains a NEGATOR before the claim, after
// PSEUDO_NEGATOR phrases ("not just", "never been easier", "no one") are removed.
// can't / cannot are deliberately not negators: "proctors can't see it" is a claim.
export const CLAUSE_MAX = 160;
export const CLAUSE_BREAK = /[.!?;:,"`<>{}()[\]|=]|(?<![A-Za-z])'|'(?![A-Za-z])/g;
export const NEGATOR =
  /\b(?:never|not|no|nor|without|won[’']?t|will\s+not|don[’']?t|do\s+not|doesn[’']?t|does\s+not|isn[’']?t|is\s+not|aren[’']?t|are\s+not|wouldn[’']?t|refuses?\s+to)\b/i;
export const PSEUDO_NEGATOR = new RegExp(
  [
    String.raw`\bnot\s+(?:just|only|even)\b`,
    String.raw`\bno\s+(?:longer|more|matter)\b`,
    String.raw`\bno[\s-]?one\b`,
    String.raw`\bnobody\b`,
    String.raw`\bnothing\b`,
    String.raw`\bnever\s+(?:been|before|again)\b`,
    String.raw`\b${NOT}\s+(?:ever\s+)?(?:get|getting|be|being)\s+${CAUGHT}\b`,
    String.raw`\bwithout\s+(?:ever\s+)?(?:getting\s+|being\s+)?${CAUGHT}\b`,
  ].join('|'),
  'gi',
);

// List-heading context. Integrity copy often lists what Geek won't do under a
// heading ("Geek won’t", "What Geek will not do") with the items themselves
// un-negated. The nearest heading-shaped phrase within LABEL_WINDOW_LINES lines
// above the claim decides: a negated heading clears the claim, an affirmative
// one ("Geek will", "What Geek does") does not.
export const LABEL_WINDOW_LINES = 25;
export const LABEL_SPLIT = /["`<>{}\n]|(?<![A-Za-z])'|'(?![A-Za-z])/;
export const LABEL =
  /^(?:what\s+)?(?:geek|we|it|this\s+app|the\s+app|the\s+overlay)\s+(?:will(?:\s+not)?|won[’']t|would\s+never|never|does(?:\s+not)?|doesn[’']t|do(?:\s+not)?|don[’']t|can(?:not)?|can[’']t|is(?:\s+not)?|isn[’']t|always)(?:\s+(?:do|does|ever|be|is|offer|offers|help|helps|let|lets|you))*\s*[:.,]?$/i;
export const LABEL_NEGATED = /\b(?:not|never|won[’']t|doesn[’']t|don[’']t|can[’']t|cannot|isn[’']t)\b/i;

// `invisible` is a Tailwind/CSS utility. A match is treated as a class name, not
// copy, when it is glued to selector or variant syntax (.invisible,
// group-hover:invisible, invisible-x) or when every token of its quoted phrase
// looks like a utility class.
export const CLASS_LIKE_BEFORE = /[.\-:/#[$@_]/;
export const CLASS_LIKE_AFTER = /[-:/=({[_]/;
export const UTILITY_TOKEN = /^!?-?[a-z0-9]+(?:[-:/[\].%#][a-z0-9[\]().%#/_-]*)+$/;
export const UTILITY_WORDS = new Set([
  'invisible', 'visible', 'collapse', 'hidden', 'block', 'inline', 'flex', 'grid', 'contents', 'table',
  'absolute', 'relative', 'fixed', 'sticky', 'static', 'isolate', 'truncate', 'italic', 'underline',
  'uppercase', 'lowercase', 'capitalize', 'container', 'grow', 'shrink', 'border', 'rounded', 'shadow',
  'outline', 'ring', 'transition', 'transform', 'filter', 'blur', 'antialiased', 'group', 'peer',
]);

# Stealth gate

Fails CI on anything that would keep Geek out of screen capture, the taskbar, the Dock or Mission Control, pose as the Moodle app, register the Moodle app's URL scheme system-wide, call eClass write or quiz-attempt functions, or claim any of that in copy (plan 4.2 invariants 3 and 4, plan 7.1, 7.2, 7.5 and 11.5, ADR 0002 and 0005).

```bash
node tools/run-gates.mjs stealth      # source mode (part of `corepack pnpm gates`)
corepack pnpm gates:built             # built mode, after `corepack pnpm --filter @geek/desktop build`
node --test tools                     # the gate's own tests
```

This version catches all of the M0 review's probe set (55 bypass attempts) except prototype reflection, which is listed under "Out of scope", and every planted file in its fake repo.

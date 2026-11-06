// Fixture: integrity copy from the public site (geek-v2-site src/pages/home.tsx,
// src/pages/integrity.tsx and src/hooks/use-hero-timeline.ts, 2026-10-10). Every
// sentence says what Geek does not do; none of it may trip the copy-claim rules.
const homeWont = {
  id: "wont",
  tag: "Geek won’t",
  title: <h3 className="text-2xl font-semibold tracking-[-0.03em]">Hide, or do the work for you</h3>,
  items: [
    "Hide from screen sharing or recording, or offer a stealth mode",
    "Act on quiz pages",
    "Submit assignments or quiz answers for you",
  ],
};

const integrityWont = {
  id: "wont",
  tag: "What Geek will not do",
  title: <h2 className="text-2xl font-semibold tracking-[-0.03em]">No hiding, no shortcuts</h2>,
  items: [
    "Hide from screen sharing or recording",
    "Offer stealth modes, or claim it can’t be detected",
    "Act on quiz pages",
    "Submit work for you, including your AI-use acknowledgement",
  ],
};

const integrityWill = {
  id: "will",
  tag: "What Geek does",
  items: [
    "Stays in your Dock or taskbar, and in full-screen shares and recordings",
    "Locks itself during quiz attempts and exam browsers",
  ],
};

export const lede = "Geek is built to help you learn in the open, not to get around the rules.";
export const share =
  "When you share your whole screen in Zoom or Meet, or record it, the overlay shows up like any other window. Geek never hides from them.";
export const limits = <li>It can&rsquo;t see a Proctorio or Honorlock extension running in another browser.</li>;
export const hero = (
  <p>
    It is always visible, it keeps a record of how you used AI on each assignment, and it never does your work
    for you. Here is exactly what that means, including what Geek can&rsquo;t detect.
  </p>
);
// renderers). Jump to the end so the hero is never left invisible.
export const lists = [homeWont, integrityWont, integrityWill];

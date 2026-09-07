# The browser a phone could not type into

**Recorded 2026-09-07, after the work.** The thirteenth click, and the one where
the Deep Scan browser worked.

## What a person saw

Their own product, rendered by Chromium inside a Vercel sandbox Vibe created
ninety seconds earlier, encoded as JPEG frames by a guard Vibe wrote, streamed
over a WebSocket behind a derived token, and painted on a canvas — `Sign in to
your product`, and the landing page under it.

Twelve failures, twelve causes, and then a picture.

## And a thirteenth, which the founder found by holding a phone

*"Geht aber glaub ich nur auf desktop bedienbar."* Correct, and for a sharper
reason than "best on desktop" suggests.

The canvas took `onMouseDown/Up/Move` and `onKeyDown/Up`, and was focusable so a
password could be typed into it. On a phone that last part is not true. **iOS
raises its software keyboard only for a focused editable element** — an input, a
textarea, something contenteditable. A canvas with `tabIndex={0}` takes focus and
raises nothing.

So a phone could show the product, scroll it and tap it, and never type a
password. Which is the entire purpose of the session. The panel said *"Deep Scan
works best on a desktop browser"*, which reads as a preference and was a wall —
and invited somebody to spend 25 Credits on a session they could not finish.

## What was built

**A hidden field, which is the only thing that raises a keyboard.** An `input`
laid over the canvas, transparent, out of the tab order, focused inside the
touch gesture — iOS ignores `focus()` outside one. It displays nothing and is
emptied after every keystroke, because text left in it would be a password
sitting in Vibe's DOM. Never `type="password"`: that would offer to save the
customer's product credential against Vibe's origin.

**Two paths for a keystroke, because a phone does not name its keys.** A key the
keyboard identifies goes through unchanged — the desktop path, byte for byte.
One reported as `Unidentified` or `keyCode: 229` is left alone, the field
receives the text, and `charactersOf` sends it character by character. Spread
rather than `split("")`: an accented character is two code units, and splitting
by index types something else.

**Touch translated rather than left to the browser.** Safari synthesizes a mouse
event from a tap but not from a drag, and never soon enough to scroll a login
page. Each touch is sent as the mouse it stands for, `preventDefault` stops the
synthesized pair arriving as a second click, and `touch-action: none` stops a
drag scrolling Vibe's page instead of the product.

**The canvas stays the tab stop and hands focus on.** It is the element with a
role and a name, so a keyboard-only person still tabs to it; `onFocus` passes
focus to the field they are actually typing into. The field is labelled rather
than `aria-hidden`, because an aria-hidden element that can still take focus is
one a screen reader lands on and refuses to describe.

## Verification

8,743 unit tests green, 15 Deep Scan browser tests green, lint 0/0, typecheck
and build clean.

The two decisions that fail silently are pure and unit-tested — a key wrongly
called composition breaks the desktop, and a character split by index types the
wrong password. The four things whose *absence* caused this are source
assertions, the substitute this repository already uses where it has no React
harness; they do not prove what a person sees, and each is one deletion away
from returning.

## What this does not prove

Nobody has signed in from a phone yet. The keyboard opens, the characters have a
path, and the touches have a translation — asserted in shape, and the next scan
from a phone is where that changes. The same sentence ADR 0076 wrote about the
build, and it was right then.

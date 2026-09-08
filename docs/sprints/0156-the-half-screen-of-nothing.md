# Sprint 0156 — The half-screen of nothing

**Date:** 2026-09-08
**Decision:** none. A layout reversal and the removal of a flag, both on the four public auth routes.

## What was asked

Three things, after the founder enabled the GitHub provider in Supabase and looked at what had shipped the day before:

1. Turn GitHub sign-in on — **without the variable**, just in.
2. Put the providers' own logos on the buttons, as in the researched references.
3. *"Das Panel ist jetzt leer, dann können wir auch die Variante HextaUI nehmen, weil der leere Bereich nicht gut aussieht."*

## What was wrong

**Sprint 0155 emptied the left panel and left the panel.** Removing the headline was right — nobody arrives at `/login` undecided, and a second pitch competes with the form. What it did not follow through on: what remained was a half-screen carrying two short lines at its foot. At 1440 that is roughly 700px of nothing beside the only thing on the page.

Emptiness reads as balance when it is symmetric and as a hole when it is not. A split screen is a promise that both halves have something to say.

**The flag had one possible value.** `VIBE_GITHUB_AUTH` existed because the Supabase provider was not enabled, and a button that fails on the provider's own error page is worse than no button. The provider is enabled now, and Vibe runs on **one** Supabase project (VB-011) — so there is no deployment where the offer is true and another where it is false. Keeping it would have meant an environment variable to set in two Vercel environments, a module, a test suite and a documentation section, all to express a constant.

**The buttons named the provider and did not show its mark.** Sprint 0155 refused the logos on the argument that the marks carry usage terms and an approximated mark is worse than a word. That is sound about an *approximation* and is not an argument against the real artwork — both companies publish these marks for exactly this use, and Google's own sign-in branding guidance requires its "G" rather than a monochrome stand-in.

## What was built

**One centred column.** The reference implementations converge on it — HextaUI's auth blocks, and the shadcn login blocks beside them, are single-column and centred — and it is the shape this content actually has. The lockup sits above the heading, the form below it, and the assurances under the form above a hairline, where they belong: they are the argument for handing over a repository, so they sit beside the decision rather than in the furniture next to it.

The mint wash moves behind the column and the grain stays over the whole page, so the material is where the reader is looking.

**No card, still.** The founder's call in UI-19 survives the change of layout. A box around the only content on the page says *this part, not the rest* where there is no rest; the column is held by its width and by the material behind it.

**Both marks, reproduced rather than restyled.** `src/components/brand/provider-marks.tsx` — Google's four-colour "G" with its published fills, GitHub's monochrome mark in `currentColor`, which is the mark as issued rather than a recolouring of it. They live outside both icon files on purpose: `icons.generated.tsx` is Lucide path data and `dashboard-icons.tsx` is Vibe's own hand-drawn set ([ADR 0097](../decisions/0097-icon-paths-come-from-lucide-the-frame-stays-vibes.md)), and a brand mark is neither. Both are `aria-hidden` — the button already names the provider, and a mark with a name of its own makes a screen reader say it twice.

**The provider buttons stack.** Side by side, the mark and four words have 178px at 390px wide, and the label wraps.

**The flag is deleted** — module, test suite, table row and documentation section. `signInWithGithub` stays exactly as it was.

## What was removed on the way

The auth footer briefly carried Terms and Privacy links, which on `/signup` put **two links to the same document 200px apart** — one of them inside the sentence that legally matters. A duplicate weakens the one that counts. The footer is the tagline alone; the agreement sentence keeps both links.

Caught by an existing guard rather than by looking: `getByRole("link", { name: "terms" })` matched two elements and failed on strict mode.

## One failure that was not this change

`the repository index fits at 768px` failed once by 4px, in a full parallel run, on a route this change does not touch. It passed three times in isolation and did not recur in the next full run.

Not called a flake and left: the spec measured horizontal overflow **without waiting for the web fonts**, and a fallback face is wider — a mechanism that produces exactly a few pixels, exactly under load. It waits for `document.fonts.ready` now. That is a fix for a real fragility, not a re-run.

## What the guards say

Browser, on the new layout and the marks:

- Both providers are offered and enabled, and each carries exactly one `svg` — with Google's four published fills present as four distinct `fill` attributes.
- The form's centre is within 8px of the page's centre line at 1440, and `main` spans the page. The split screen fails both halves of that.

Source, comments stripped — the docblock explaining why the flag is gone *contains its name*, and an assertion that reads prose proves nothing (the same trap as Sprint 0154):

- No form and no provider row reads `VIBE_GITHUB_AUTH` or `githubAuthEnabled` again.
- Each provider is still its own form: sharing one lets the email field's `required` validation block a provider button.
- The Google mark keeps all four published colours, and both marks stay out of the accessibility tree.

`providers.test.ts` is gone with the module it tested; its two composition assertions — `FormError` over a field error, and no card — moved to `src/app/login/auth-screens.test.ts`.

## Validation

Unit 8,853 · browser 614 · lint 0/0 · typecheck clean · no migration. Screenshots at 1440 and 390 on all four routes.

Layout references consulted: [HextaUI auth blocks](https://www.hextaui.com/blocks/auth-login-form), [shadcn login blocks](https://ui.shadcn.com/blocks/login).

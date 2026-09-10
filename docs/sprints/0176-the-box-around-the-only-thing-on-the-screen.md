# Sprint 0176 — The box around the only thing on the screen

**Date:** 2026-09-08
**Decision:** none. The design pass over the four public auth routes, on the logic Sprint 0175 fixed.

## What was asked

Design the auth screens, after the logic. Research first: load the design skills, look at what the registries and the reference products actually do with a sign-in screen, and show it before building anything.

Six decisions came back from that research: **no frame** around the form; the left panel keeps its material and the assurance lines but loses the headline (my proposal, chosen over the alternatives); the switch to the other screen moves above the first field; the form-level error placement gets fixed; add a password reveal; prepare GitHub sign-in.

## What the research said, and what was not taken

Searched Vibe's own inventory first, then shadcn, then the registries, for the shape of a two-column authentication screen. What came back was mostly the same page: a centred card on a gradient, a row of brand-marked provider buttons, a headline on the left half repeating the landing page's pitch.

Three of those were refused, each for a stated reason:

- **The card.** The form already sits alone on its half of the screen. A card is a way of saying *this part, not the rest*; where there is no rest it is a box drawn around the only content. The fields are wells with their own borders; the ground is the ground.
- **The headline on the panel.** *"You vibe-coded the product. Now vibe the business."* is on the landing page, which is where somebody undecided is standing. Nobody arrives at `/login` undecided. A second pitch beside the form competes with the one thing the screen is for.
- **The brand icons on the provider buttons.** Google's and GitHub's marks have usage terms, and an approximated mark is a worse answer than a word. The buttons say what they do.

What was taken is compositional: the panel as material rather than as a message, the assurances as a footing rather than a floating pair, and the provider row above the credentials with a labelled rule between them.

## What was built

**The panel says two things, and both are true of the implementation.** *Changes land on their own branch.* *Nothing merged without your approval.* Rules 58, 67 and 71 — properties of the system, not claims about it. They are anchored to the foot with the tagline under them: the first screenshot had them centred in a tall empty half, where two lines read as content that lost its container. At the bottom they read as a footing, and the emptiness above becomes the material.

**The switch moved above the first field.** It answers *am I on the right screen*, and that is asked before the first field, not after the last. It was under the submit button, so somebody who opened sign-in meaning to create an account read the heading, typed an email, typed a password, and only then met the sentence telling them they were in the wrong place. `AuthHeading` carries the title and that one line.

**The form-level error has a form-level home.** Sprint 0175 recorded this and left it: *"Enter your email and password"* and *"We couldn't reach the server"* both rendered as a `Field` error on **password**, under one of the two fields they were not about — which tells a reader the other one is fine. `FormError` is a `role="alert"` block between the fields and the submit, described by both inputs.

**The password can be checked.** Eight characters minimum with no way to see what was typed is a real failure rate on a phone, and on sign-in a typo is indistinguishable from the wrong password. `PasswordInput` is masked at every mount — a password revealed at first paint is a password in a screenshot and in a screen share — with the toggle inside the field, an `aria-label` that changes, and an `sr-only` status region stating the current state.

**GitHub sign-in is written and not offered.** `signInWithGithub` mirrors `signInWithGoogle`. Whether the provider is enabled is a setting in the Supabase project that no code here can read, so a button rendered unconditionally fails on the provider's own error page for a reason nobody on the sign-in screen can see or fix. `VIBE_GITHUB_AUTH=1` says step one was done.

## Why an environment variable is allowed here

CLAUDE.md rule 78 forbids gating a customer capability on an environment variable *nothing documents*, and both halves matter.

It gates no capability: every account, project and operation is reachable through the providers already offered, and GitHub sign-in is a second door into the same room. And it is documented — `docs/deployment/environment.md` carries the row, the two-step ordering (the Supabase provider first, the flag second) and the reason the reverse order ships a button that cannot work. A test reads that file and fails if the name is not in it.

## What the guards say

Five new browser claims and two new source suites. Four were mutation-tested by restoring the behaviour they forbid:

- The submit button has no `.vibe-surface-card` ancestor. Wrapping the form in a `VibeCard` fails it — and the class was checked against `surface.tsx` first, because a guard naming a class nothing emits passes forever.
- The switch link sits above the email field.
- "Forgot it?" sits above the password input and within 40px of it — beside the label, not below the form. Moving it back under the form fails it.
- The password field is `type="password"` at rest, becomes `text` on the toggle, keeps its value across the switch, and returns. Starting revealed fails it.
- `google-signin` is offered and `github-signin` is not, because the test server sets no flag.

And in unit: the flag is off for everything but exactly `1`, both screens ask `githubAuthEnabled()` before offering the button, the name appears in the deployment document, all four forms use `<FormError`, none of them hangs a form error on a `Field` again, and none contains `VibeCard`.

**One mutation was mine and worthless**: renaming the documented variable to `VIBE_GITHUB_AUTHX` left the guard passing, because the longer string still *contains* the shorter one. Deleting the mentions properly failed it. A mutation that does not change what the assertion reads proves nothing about the assertion.

## What changed that was already passing

One pre-existing browser guard pinned the sign-up provider button to `Continue with Google`. The `verb` prop makes it `Sign up with Google` on `/signup` and `Continue with Google` on `/login`: the same OAuth call creates an account on one screen and signs in on the other, and a person who came to create one should read a button that says so. The guard carries the new string and the reason, rather than being loosened to a substring.

## What is not done

The sign-out, profile and settings screens on the founder's list. The panel's radial wash is static; the drifting glow from the mockups belongs to the motion sprint, and the shape it animates is already in place, so that sprint is a change of one declaration.

## Validation

Unit 8,853 · browser 613 · lint 0/0 · typecheck clean · no migration. Screenshots taken at 1440 and 390 on all four routes.

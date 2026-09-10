# Sprint 0215 — What should I call you?

**Date:** 2026-09-10
**Decision:** no new ADR. `founder_profiles` already decided that a name is asked for and stored; this is the three places that never read it, plus the one place that never asked.

## The bug was not a wrong answer

`buildAccountIdentity` has preferred the founder's own name over everything else since `founder_profiles` shipped. Settings → Profile passed one in from the day it existed. The rail never did.

So a founder could type what they wanted to be called, see it on that page, and find their GitHub login on every other screen in the product. Nothing failed, nothing logged, no test went red — **an optional argument left out is not an error.** The rail rendered a real identity; it just was not theirs.

The same omission was in both screens that greet. Each read `identity?.githubLogin ?? null` and reached straight past the name, because the login was all there was when they were written.

The fix for the class rather than the instance is a sweep: every `buildAccountIdentity` call site in `src/app/` has to pass `founderName`. It found a third one immediately — the wireframe study, which reviews the rail for a founder the product cannot name. It now says `founderName: null` out loud, because an omission there reads exactly like the bug it caused.

## Two questions about one person

The rail asks *who is signed in*, and an email address is a good answer — it is what we have, printed as what it is. A greeting asks *what do I call you*, and an address is not an answer to that at all.

`greetableName` is that second question, and it exists so the two screens cannot answer it differently, which they did. It takes the same inputs `buildAccountIdentity` does rather than the identity it builds, because an identity carries an email and this function's whole point is that an email is not an answer — a caller would have had to pass a null one in to ask the question, which reads as a lie about the account.

## She asks even when there is a login

A GitHub login is a name in the sense that a person chose it. It is not what anybody is *called*. An assistant that opens with a handle is reading a database out loud, and the distance between that and a colleague is most of what the opening screen is for.

So she greets by the login **and** asks. The question is last, after everything she says about herself: asked before the introduction it is a form; asked after it, it is the first thing two people do.

Leaving the box empty is a supported answer. `normalizeFounderName` reads it as null, the row is deleted rather than written blank, and she keeps the nameless greeting — which was never a degraded greeting, only the same warmth without a claim in it.

## The guard that said no, and what was done about it

`nova-ui.test.ts` sweeps Nova's files for `<textarea`, `type="text"` and `placeholder=`. It is not a style rule: **Nova is not a chat box**, there is nothing to type at her, and that is the claim `feed.test.ts` holds the other half of.

A name field is not a chat box, but the guard was absolute and it was protecting something true. Editing it green would have been the cheapest thing in this whole session and the worst. It was narrowed instead, in the open:

- `<textarea>` stays forbidden **everywhere, with no exemption**. A multi-line box is a chat box whatever the label says.
- Exactly one file may hold a text input, and a second test makes it prove it is the name field: one box, `name="displayName"`, bounded by the shared `MAX_FOUNDER_NAME_LENGTH` and not by a number typed into a screen.

The reconciliation is that this is a **label, not an instruction**. It is normalised to one plain line, has a database CHECK behind it, and is fenced as untrusted data wherever it reaches a model (rule 42). It is written through `setFounderName` — the same door the profile form uses — because a second write path is a second place for that to be true, and the first time they disagreed the disagreement would be a name in a prompt the front door would have refused.

## And the sweep that would have missed it

`first-run.test.ts` collects every sentence Nova says in her introduction and holds it against the voice rules — no causes, no deploy words, nothing called safe, no figures. It built the feed with default arguments, so the introduction that *asks* was not in the set: the newest thing she says would have been the one thing nothing checked.

That is the same defect this branch has now recorded four times — **a guard that names something adjacent to its subject** — and it is worth noticing that it recurs in the sweep-style tests specifically. A sweep is only as wide as the arguments it builds its input with.

Unit 9,508 · browser 831 with 5 new · tsc clean · eslint 0 · build clean

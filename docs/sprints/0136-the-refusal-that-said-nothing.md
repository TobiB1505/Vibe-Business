# 0136 — The refusal that said nothing

Date: 2026-09-03
Branch: `claude/agent-preview-diff-logic-sxj5uc`

## What this was for

No ADR. This changes no decision — it finishes applying one the code had already argued for and only half-used.

`plan/page.tsx` asks the execution resolver about every step, and its own docblock says why:

> The stored `executionSupport` knows only the deterministic registry, so a step the coding agent could build reads "Not automated yet" on this screen while the Agent workspace offers to run it. The resolver is the layer that knows, so it is asked here.

That reasoning was applied to the *yes*. When the resolver answered **no** it also said why — and `stepResponsibility` took only `intrinsicMode` and threw the reason away. So every refusal, whatever its cause, fell back to the stored four words: **"Vibe's work / Not automated yet."**

## Why it mattered more after Stufe 5

`ANALYZER_VERSION` → v6 made every stored snapshot stale at once. Until a founder re-scans, every `vibe`/`product_change` step in every plan resolves `repository_analysis_outdated` — and reads "Not automated yet".

For that reason the sentence is not merely vague. **It is false.** The work *is* automated; Vibe's read of the code is one version old, and a free scan is the whole of what stands in the way. A founder had no way to learn that from the screen they spend their time on.

The same held, less sharply, for every other repository fact the build contract now distinguishes: no lockfile beside the app, no `build` script, no `package.json`, a lockfile Vibe will not install from, or an unanswered question about which app. Each of those has a sentence — `EXECUTION_REASON_LABELS` has carried them since Stufe 4 — and the plan screen showed none of them.

## Shipped

`stepResponsibility` reads the resolution's `reason` as well as its mode, and a closed set of reasons replaces the fallback with the sentence that names the missing thing.

**The set is the whole design, and it is drawn along one line: is this a fact about the repository, or about the step?** A step waiting on an earlier one, owed a founder decision, or refused for touching payments is a fact about the step — and the row already prints its own sequence status directly beneath it, so repeating it here would say one thing twice. Every reason in the set is a fact about the repository, which the row says nowhere else, is the same for every step in the plan, and is actionable.

The headline does not move. Whose work it is and whether Vibe can currently start it are different questions, and only the second changed.

## Verification

The unit tests assert both halves: each repository reason produces its own sentence, and a step-level refusal still reads exactly as it did. One asserts the specific falsehood by name — a stale analysis must never be described as work Vibe has not automated.

A browser scene renders the state a founder will actually meet after the v6 bump, beside the existing scene for a step the agent *can* build: the two are counterparts, and the new one asserts the old sentence is gone as well as the new one present. The control assertions come along unchanged, because the copy changed and the affordance did not.

Domain 7,708 across 446 files · SQL 312 · browser 491 · lint 0/0 · build green.

## What this does not do

**It does not add a way forward on this screen.** The sentence for a stale analysis says to refresh it; the link to the scan lives on the Agent screen, not here. That is a smaller version of the dead end this repairs, and it is left named rather than quietly fixed — the plan row is a compact label, and putting an action in it is a design question rather than a copy one.

**And no founder has seen it.** Every claim above is about what the screen renders for a resolution shape, proven in a browser against a fixture. The state is universal right now for the three projects still on v5, so the first real reading of it is one click away.

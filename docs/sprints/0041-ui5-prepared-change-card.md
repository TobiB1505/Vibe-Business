# UI-5 — The Prepared Change Card

**Status:** implemented, then corrected by its own first dogfood. Lint / typecheck / 4562 unit
tests / build / 298 browser E2E green. Two things are deliberately **not** claimed — see *What has
not been proved* below.

Derived from the product UI/UX audit of 17.08.2026 (`docs/audits/2026-08-17-product-ux-audit/`,
findings **F-2**, **F-3**, **F-11**, **F-12**, **F-24** and the execution-surface findings), which
shipped on its own branch.

## Problem

The audit called this card the largest single perception gain available in the product: the
machinery beneath it is the best in the repository and its presentation was the weakest.

**It led with a branch name.** Eleven sections in pipeline order under a mono `vibe/…-cc32273131c5`
heading, and the human meaning — "What Vibe changed" / "Why this matters" — sat **ninth of
eleven**, *below* the Approve and Merge buttons. A person was asked to authorize a
default-branch write before the screen had told them what the change was for. The comment above
that block claimed the order "what changed → why it matters → what was confirmed"; the code said
otherwise.

**Three sentences were false on a merged, verified change.** "Not merged · Not deployed · Not
reviewed by a human" (validation), "A comparison is evidence, not a verdict · Not approved · Not
merged · Not deployed" (review) and "Nothing has been merged or deployed." (approval) were
unconditional inside their own success branches, so a change already in the default branch was
greeted by all three at once — on the screens a person trusts most. A fourth instance sat in the
preview panel.

**The approval stayed revocable after the merge it authorized**, offering "Revoke approval" for a
write that had already happened and been read back.

**Drift ended at "Not available"** plus a `text-xs` line, with no way forward at all.

**And none of it was fixable with an `if`**, which is the root cause under all of it: the gate
order existed six times as prose and once as the order of JSX siblings, and **not once as data**.
No code could ask how far a change had got, so every panel could only speak for its own gate — and
the ones that say what has *not* happened yet said it forever.

## Changes

- **The chain became data.** `src/modules/execution/change-progress.ts` — pure, synchronous, in the
  shape of `operations/view.ts`. It reads the answers the gates already gave and says which one the
  change is sitting on, in one derivation with one table of sentences. It re-decides nothing and
  permits nothing: whether a merge may happen is still `merge.canMerge`, freshly checked.
- **Meaning moved to the top.** The card opens with where the change stands, then what it is and
  why it matters; branch, commit and paths follow as a compact identity row. True, checkable, and
  not the first thing anyone needs. `change-rationale.tsx` is untouched — its own source test
  forbids it importing outcome or measurement state.
- **The four settled gates fold.** Validation, preview, review and approval collapse behind one
  `<details>` once an approval stands, because an approval cannot exist without a validation that
  passed and a review that is ready — so one answer settles all four, and a revoked or superseded
  approval correctly opens them again. Merge, Outcome and Business impact never fold: those are the
  answers a person came for.
- **The disclaimers render clause by clause, only while true.** The sentences are unchanged and
  still deliberately repeated where success is most likely to be over-read. The deployment half
  never drops, because Vibe never deploys.
- **An approval after its merge is a record, not a decision still in play.** No revoke control.
- **Drift names a way forward without spending anything.** A GitHub compare link built by
  `buildCompareUrl` — deterministic, in the card rather than the merge panel, whose action
  allowlist is exactly two labels — and a sentence saying what still holds. No re-run, no refresh:
  offering one would be Vibe starting paid work on the user's behalf (rule 60).
- **The two dead ends explain themselves.** `not_observed` and `failed` now say that the change is
  still in the repository and that the checking window has closed, with the closing time when the
  row carries one — and still offer no control. `failed` also gained the ladder every other
  terminal answer had, so "Business impact: Not measured" no longer goes missing on the answer that
  leaves a user least certain what is true.
- **Vocabulary and one colour.** "artifact" → words a founder uses, "policy" → "rules" where the
  prose beside it already said rules, and sky — the only non-token colour pair in the product —
  gone from the merge dialog and the active validation phase.

## The defect this sprint reintroduced, and then removed

The first commit gave the derivation one stage, `validating`, covering three situations: nothing
had been checked, a check was in flight, and a check had run and failed. All three got the sentence
"Vibe is checking this change is safe." It was true for exactly one of them.

That is precisely the class of defect this sprint exists to remove, written by the code meant to
remove it. It survived twenty-three unit tests and was found by building a fixture for the open
state and looking at the screen it produced — which is the argument for the fixtures below, made
concrete.

## Test pressure that shaped the work rather than being worked around

The prepared-change surface is pinned harder than anything else in the repository, and the
constraints were treated as decisions rather than obstacles:

- **Four panels carry exact action-label allowlists**, so any new `<button>` or `<a>` inside them
  fails immediately. The compare link therefore lives in the card, and the fold is a `<summary>` —
  which the allowlist extractor does not see, because it extracts only buttons and anchors.
- **~40 `toBeVisible()` assertions** cover Merge, Outcome and Business impact. That is why only the
  early gates fold: the suite encodes the opposite intent for the rest, deliberately.
- **Four positional slices** cut at comment text or between declaration names, so nothing was
  renamed or reordered around them.
- **The approval-copy browser test** now opens the disclosure first. The three sentences it checks
  are unchanged — the fold is what moved, not the copy.

## What the fixtures could not previously prove

Every prepared-change scenario written before this sprint is approved: validation passed, preview
stopped, review ready, approval given. So the only form of the card a browser had ever rendered was
the folded one. Two scenarios now cover the states before an approval — a change waiting on a
person, and a change nobody has checked yet — and the suite asserts both the open form and the
folded one.

`change_not_validated` carries no validation rather than a running one, on purpose: see below.

## Architecture intentionally unchanged

- No detail route per prepared change. Every change still stacks on one page.
- `canVerify` is untouched. The outcome dead ends are explained better, not made repeatable — that
  would be a domain change and a paid re-observation.
- Merge, Outcome and Business impact do not fold.
- Every stage label, failure message and status vocabulary in the domain modules is untouched. This
  sprint changed the order and the conditions, never the words the domain owns.

## The first dogfood, and what it cost to look

This sprint shipped saying the card had never carried a real change. It has now — a deployed
preview of this branch, opened on a project with seven prepared changes — and the first screen
found **two** defects that nineteen fixtures and 4,542 unit tests did not.

**The headline narrated work nobody was doing.** "Vibe is preparing what you need to review", above
a preview that was never started and a review waiting for one. The `reviewing` stage stood for a
comparison being built *and* for a comparison nobody had started — the identical conflation this
sprint had already found and fixed one gate earlier, in `validating`, and then reintroduced by not
looking one step further. It is now three stages: Vibe preparing something, the founder's turn, and
a comparison that failed or expired.

**An agent-written change had nothing to lead with.** `businessRationaleFor` is a per-capability
lookup, and every change an agent will ever write carries `agentic_execution_v1` — so it returns
null, the rationale section returns null with it, and the card opened with a status line and then a
branch name. Exactly the screen this sprint set out to replace, reappearing for the change type the
product is moving toward, and not fixable by adding a table entry: one sentence per capability
cannot describe changes that differ per change.

Such a change now leads with the Move it was asked to address, under **"What this change was
for"** — never the rationale's heading — and closes with an unconditional line saying it is the
request, written before the change existed, and not a description of what the change did. The text
is the same text the Moves panel already shows: a second view, not a new class of claim, and it is
rendered and nothing else.

**What is worth writing down is why the fixtures missed both.** Neither defect needs an unusual
state. Both need a *combination* — validated but unpreviewed, agentic but unapproved — and every
scenario written before this sprint was approved, deterministic, or both. `change_agentic_review_required`
is now that combination, rebuilt from the screen itself rather than invented.

## What has not been proved

**The seven gates end to end.** A real change reached the card and produced two fixes; it has not
been driven through validation, preview, review, approval, merge and outcome in one run. The
fixture harness renders the real panels with the real server-decided cards, but the wiring in the
workspace read model that produces those cards is still only exercised by hand.

**A running validation still renders as "Not validated" after a reload.** Found while building the
fixtures, and left alone: `prepared-changes-section.tsx` hands the validation panel
`runningOperation={null}`, so the panel's in-flight branch is reachable only within the browser
session that pressed the button. `getLatestValidation` returns queued and running rows, so a reload
mid-validation shows "Not validated" and offers "Validate change" — a second paid run. The card's
headline is correct there; the panel below it is stale. Fixing it means surfacing the operation
through the read model, which is a read-model change outside this sprint's scope and is recorded
here rather than papered over with a fixture that asserts the contradiction is fine.

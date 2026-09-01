# The review that was required and could not help

**Recorded 2026-09-01, after the work.** One slice: give the review classification that has existed since [Sprint 0048](0048-automatic-validation-and-review-classification.md) something to decide, and build the diff that had to exist first. See [ADR 0063](../decisions/0063-review-classification-as-a-gate.md).

No preview redesign. No change to the visual review domain. No change to how a merge is authorized. No new dependency.

## The defect, in one paragraph

`classifyReview` answered *which review does this change deserve?* — `visual | code | visual_and_code`, deterministic, no model call — and [ADR 0037 §2](../decisions/0037-automatic-validation-and-review-classification.md) deliberately gave it no authority. Meanwhile `approvals/service.ts:181` refused every approval with `approval_review_required` until a before/after screenshot comparison was `ready`, and `change_approvals.review_artifact_id` was `not null`.

So a change that alters no rendered page could only be approved after the user paid for a preview sandbox (~$0.022) and a browser session to produce **two identical pictures of a page that did not change** — and that pair was then presented as the evidence they decided from. ADR 0037 named that failure mode and then required it.

Its only call site was `agent-dogfood/[stepKey]/actions.ts:223`, an internal page.

## The second half, which is why this could not be a one-line change

There was nothing to show instead. `execution/diff.ts` rendered added lines only, and said so:

> This capability only ever adds files, so the "diff" is the added content. A capability that modified existing files would need base-vs-head comparison; that is a different capability and a different renderer.

The agent modifies files that already exist. For every change it produces, the only in-app diff was structurally wrong, and the review panel's "View code diff" was a link to GitHub.

## What was built

| | |
|---|---|
| `execution/diff-lines.ts` | line-level LCS, written not installed. Hunks, bounded context, a cell-product ceiling above which a file degrades to a wholesale replacement rather than an unbounded computation |
| `execution/diff.ts` | rewritten to read **both** versions at `base_sha` and `commit_sha` through the bounded repository reader — never at a branch name, which moves |
| `execution/code-review-digest.ts` | the identity of a rendered diff: sha256 over project, change, both commits, sorted paths and `DIFF_POLICY_VERSION` |
| `components/change/diff-view.tsx` | `+`/`−` in green and red, two-sided line gutter, plain text in `<pre>` |
| `approvals/*` | a second evidence form, chosen by the classification, pinned onto the row |
| `execution/change-progress.ts` | `reviewGate` consults the classification; `code` reaches `awaiting_approval` with no preview and no comparison |
| `execution/workspace.ts` | the classification computed for the list, at **zero** added database reads per card |
| migration `20260901120000` | `review_artifact_id` nullable, three CHECKs, a fourth invalidation reason |

## The three decisions that were not obvious

**A diff is stronger evidence than a screenshot.** This runs against intuition and is the argument the whole ADR rests on. `code_review_digest` hashes what *reproduces* a diff, not the bytes — two immutable commits and a path list regenerate it byte for byte, indefinitely. A `review_artifacts` row cannot: its images expire at seven days, and its "before" side is production as observed at capture time, which has since moved. So the code path binds an approval to something *more* durable, which is what makes it compatible with rule 67 rather than an exception to it.

**The merge gate must not re-ask the classification.** This was the near-miss. The classification reads the analyzer's resolved surface, and a newer snapshot can turn a `code` change into a `visual` one with nothing about the change having moved. Had `findActiveApprovalForCurrentArtifact` recomputed it, a real, standing, unrevoked approval would simply have stopped being found — a merge refused on the strength of a route table the approver never saw, which is precisely what rule 68 forbids. It now reads the evidence form off the approval row and recomputes the identity around it; everything else is still re-derived from live state.

**`deleted` is not a diff file status.** `getTextFile` returns `null` for an absent file, a binary one and an oversized one alike, so a missing head side cannot be told apart from a deletion — and the GitHub writer refuses deletions anyway. `candidate.ts` records making the opposite mistake once, where an oversized build artifact read as the agent removing a repository file. Reported as `unreadable`.

## What the tests caught

Three things, and each was a real defect rather than a test that needed adjusting.

**`workspace.test.ts` caught a fan-out coming back.** VB-023's invariant is that eight prepared changes cost what one costs. Naively calling `classifyReviewForPreparedChange` per card took a render from 11 reads to 32 — the prepared change re-read, the analyzer snapshot re-read, and a four-read walk to evidence-derived scopes that the classifier documents as *carried for the explanation, never consulted for the decision*. Fixed by handing in the row the list already read, sharing one route table, and passing `requirement: null`. Then it caught a second one: making code-only changes approvable made `getApprovalCard`'s identity lookup run for every card instead of almost none, so that lookup now answers from the prefetched row wherever the stored hash decides it.

**`merge-ui.test.ts` caught a new control on the merge panel.** The suite that exists to stop a Deploy button appearing next to a merge. The addition was a same-page anchor to the diff; it is now on the allowed list with the reason it is not an offer.

**`e2e/review-classification.spec.ts` caught a panel no test could name.** The heading was nested in a layout wrapper, so `section:has(> h4:…)` — the scoping every other panel's browser test uses — matched nothing. Restructured, which is also what makes it consistent with Preview, Review and Merge.

## Verification

| Layer | Result |
|---|---|
| Domain (`pnpm test`) | 411 files, 7,102 tests |
| SQL/RLS (`pnpm db:test`, real PostgreSQL) | 183 tests, 8 new for the evidence constraints |
| Browser (Playwright, chromium) | 413 tests, 4 new |
| `pnpm lint`, `pnpm build` | clean |

**Not dogfooded.** Rule 69's fourth question is unanswered: no real agent run has gone through this path end to end, and the saving it is meant to produce — a merged change with no rows in `sandbox_usage_events` for a preview and none in `review_browser_usage` — is derived rather than observed. Recorded as a gap in [ROADMAP.md](../ROADMAP.md), not claimed here.

**One environment note.** `pnpm test:e2e` cannot launch in this container: Playwright 1.62.1 expects `chromium_headless_shell-1234` and the image carries `-1194`. Pre-existing, unrelated to this work, and the suite passes in full when pointed at the browser that is present.

## What this deliberately did not touch

- No review is auto-started. `src/modules/review/service.ts`'s rule that nothing there is automatic is untouched.
- Preview ([ADR 0016](../decisions/0016-temporary-preview-isolation.md)) and visual review ([ADR 0017](../decisions/0017-visual-review-artifacts.md)) are unchanged. What changed is when they are asked for.
- The merge write ([ADR 0019](../decisions/0019-safe-approved-change-merge.md)) is unchanged.
- `code` does not skip validation. Only the visual gates were removed.

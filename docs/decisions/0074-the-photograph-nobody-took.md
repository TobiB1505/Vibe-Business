# 0074 - The photograph nobody took: the visual review capture path is deleted

Status: Accepted
Date: 2026-09-02

Completes [ADR 0065](0065-the-preview-is-the-review.md), which decided this and
deferred it. Supersedes nothing further: 0065 already superseded
[ADR 0017](0017-visual-review-artifacts.md) as a gate, and this ADR removes the
code that decision left standing. No price moves, no schema is dropped, and no
historical row becomes unreadable.

## Context

ADR 0065 shipped on 2026-09-01 and wrote down exactly what it was leaving
behind:

> **The screenshot path is unreachable, not deleted.** `startChangeReview` and
> `changeReviewWorkflow` still exist and no screen, gate or server action
> reaches them […] Deletion is a later slice, once the last artifact has passed
> its seven-day retention.

That condition is met. The newest row in `review_artifacts` is from
2026-08-14 — nineteen days old, and past a seven-day retention by twelve.
Nothing in the table can be re-captured, refreshed or compared against, and
nothing can create a new one: the server action that started a capture was
removed by 0065, and it was the only entry point.

So there is nothing left to decide about the capture path. There is only the
question of what a deletion must **not** take with it, and that is where the
work was.

## What the data required to stay

Three counts were read before deleting anything, because each one would have
turned a tidy deletion into a broken record.

**One `change_approvals` row carries a `review_artifact_id`.** A human looked
at two screenshots on 2026-08-14 and approved a change on that basis. Rule 67
binds an approval to an immutable artifact identity, and an approval whose
evidence can no longer be displayed is an approval nobody can audit. So
`getReviewCard`, `getReviewImages` and the signed-URL rules stay, and the
authorization tests that guard them stay with them — those were always the
dangerous half. The images themselves are already gone with their retention;
what stays is the card that says what was photographed and when.

**Two `operation_runs` rows carry `change_review`.** The operation type stays in
`OperationType` and in the SQL CHECK. Dropping either would make two rows of
operation history unreadable to the application that wrote them, which is the
schema-skew failure the deployment doc forbids in the other direction. It costs
one dead key in the `WORKFLOWS` record, and the record is what makes *forgetting*
a workflow a type error — a property worth more than the key.

**`sweepExpiredReviewScreenshots` still has a caller.** `change-review/retention.ts`
is imported by `change-preview/teardown-execution.ts`. Retention is not the
capture path; it is what empties the bucket, and it is exactly as necessary for
artifacts nobody will make more of.

## Decision

Delete the capture path and nothing else.

Gone: `review/browserbase/capture.ts` and its test, `review/browser-port.ts`,
`operations/change-review/execution.ts`, `operations/change-review/workflow.ts`
and its test, `startChangeReview` and its result types, `view()` /
`resolveReview()`, `recordReviewBrowserUsage`, and the capture half of
`review/test-support.ts`. Roughly 1,975 lines net.

`change_review` maps to a `retiredWorkflow` that throws. Resolving successfully
would be worse than throwing: it would leave a row that never finishes, on an
operation nothing should have started.

`review_browser_usage` keeps its rows and loses its writer. The table is a
record of browser sessions that were paid for; `provider_cost_usd` is null in
every row and stays null, because no Browserbase rate exists in this repository
and inventing one to close a column is the failure `margin-guard.ts` refuses by
design. `deep_scan_provider_usage` is a different table and is untouched.

`@browserbasehq/sdk` and `playwright-core` remain production dependencies. They
are the Deep Scan's, under [ADR 0012](0012-authenticated-browser-analysis.md),
and always were — 0017 was the second consumer, not the reason either is
installed. CLAUDE.md rule 38 named 0017 as one of the two decisions that lifted
the browser prohibition; it is rewritten in place to name only the one that is
still building something, because a rule that cites a deleted path as
justification is the same defect Sprint 0127 repaired one sentence earlier.

## What this does not claim

It does not claim the screenshot comparison was a bad instrument on its own
terms. 0065 made that argument and it stands. This ADR claims only that a
mechanism no route reaches, whose last artifact has aged out, is better read in
git history than carried in `src/`.

It does not claim the read path is exercised. One approval depends on it, and
that approval is fifteen days old. The seven tests that remain assert
authorization and expiry against a fake store; they would catch a regression,
and they are not evidence that anybody has opened the card recently.

## Consequences

The `review/` module is now a reading module. It classifies (`classification.ts`,
which is a live gate under [ADR 0063](0063-review-classification-as-a-gate.md)),
and it renders one historical artifact. Nothing in it opens a browser, and there
is no longer a file that could.

The test count falls by 24. That is the correct direction and worth stating
plainly, because the alternative reading — a suite got smaller, so something got
worse — is the one that keeps dead code alive. What those 24 tests asserted was
the behaviour of a path with no caller.

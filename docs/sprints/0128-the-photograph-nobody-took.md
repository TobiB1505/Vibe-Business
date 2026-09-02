# The photograph nobody took

**Recorded 2026-09-02, after the work.** The first of two steps the founder
asked for in sequence: delete the dead visual review path, then rebuild Deep
Scan onto the sandbox. This is the first.

## What it was

ADR 0065 shipped the day before and left a note to itself: the screenshot path
is unreachable, not deleted, and deletion is a later slice *once the last
artifact has passed its seven-day retention*. I read that condition as a date
and got it wrong the first time — I told the founder deletion would be allowed
"tomorrow", from a 2026-08-27 row in `review_browser_usage`. Wrong table. The
gate is `review_artifacts`, whose newest row is **2026-08-14** — nineteen days
old, twelve days past. The work was already permitted when I said it was not.

Worth recording because the error was not a miscalculation. It was reading the
retention clock off a table that measures something else — browser sessions
billed, not artifacts retained — and the two happen to have similar names.

## The three counts that shaped the deletion

Everything interesting happened before a file was removed, and all of it came
out of the database rather than the code.

**One `change_approvals` row carries a `review_artifact_id`.** A human approved
a change on 2026-08-14 on the strength of two screenshots. Rule 67 binds an
approval to an immutable artifact identity; an approval whose evidence cannot be
displayed is one nobody can audit. So the read path stays — `getReviewCard`,
`getReviewImages`, the signed-URL rules, and the seven authorization tests that
were always the dangerous half. The images themselves aged out with their
retention; what stays is the card that says what was photographed.

**Two `operation_runs` rows carry `change_review`.** The operation type stays in
`OperationType` and in the SQL CHECK. It maps to a `retiredWorkflow` that
throws, and throwing rather than resolving is the deliberate half: a silent
success would leave a row that never finishes. The dead key is the price of a
`Record` over the closed union, which is what makes forgetting a workflow a type
error.

**`sweepExpiredReviewScreenshots` still has a caller** — `change-preview/teardown-execution.ts`.
Retention is not the capture path. It is what empties the bucket, and it is
exactly as necessary for artifacts nobody will make more of.

## What was deleted

`review/browserbase/capture.ts` and its test, `review/browser-port.ts`,
`operations/change-review/execution.ts`, `operations/change-review/workflow.ts`
and its test, plus `startChangeReview`, `view()`, `resolveReview()`,
`recordReviewBrowserUsage`, and the capture half of `review/test-support.ts`.

**2,041 lines removed, 66 added.** Test count 7,379 → 7,355; the 24 that went
asserted the behaviour of a path with no caller. Stating the direction plainly
matters here, because the opposite reading — the suite shrank, so something got
worse — is what keeps dead code alive.

## What was deliberately not touched

- **`review_browser_usage` keeps its rows and loses its writer.** `provider_cost_usd`
  is null in every one and stays null: no Browserbase rate exists in this
  repository, and inventing one to close a column is what `margin-guard.ts`
  refuses by design. The roadmap entry naming that gap is still true.
- **`@browserbasehq/sdk` and `playwright-core` stay production dependencies.**
  They are the Deep Scan's under ADR 0012 and always were — 0017 was the second
  consumer, never the reason either is installed. CLAUDE.md rule 38 cited both
  decisions as lifting the browser prohibition; it now cites only the one still
  building something. Rewritten in place, never renumbered — the same repair
  Sprint 0127 made to the same rule one sentence earlier, for the same reason: a
  rule that justifies itself with a deleted path is a lie the next session will
  act on.
- **`review/classification.ts`** is a live gate under ADR 0063 and is untouched.
  The `review/` module is now a reading module, and that is the whole of it.

## Verification

`pnpm test` 427 files / 7,355 tests green, `pnpm typecheck` clean, `pnpm lint`
clean, `pnpm build` green. No migration: nothing was dropped, because two rows
of operation history and one approval say nothing may be.

## What this does not prove

Nobody has opened the historical review card recently. The seven remaining tests
assert authorization and expiry against a fake store — they would catch a
regression, and they are not evidence that the surviving path is exercised. The
one approval that depends on it is fifteen days old.

[ADR 0074](../decisions/0074-the-photograph-nobody-took.md).

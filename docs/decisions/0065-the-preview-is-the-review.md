# ADR 0065 — The preview is the review

**Status:** Accepted — 2026-09-01; its deferred deletion was carried out by [ADR 0075](0075-the-photograph-nobody-took.md) on 2026-09-02
**Supersedes:** [ADR 0017](0017-visual-review-artifacts.md) in its role as a gate. The artifacts themselves, their retention, their storage policy and their signed-URL rules all stand for the rows that exist; nothing new is created.
**Amends:** [ADR 0063](0063-review-classification-as-a-gate.md) — the classification still decides, and what `visual` calls for is now a preview rather than a comparison. [ADR 0018](0018-human-approval-authority.md) gains a third evidence form.
**Related:** [ADR 0064](0064-preview-before-validation.md), [Sprint 0114](../sprints/0114-the-preview-is-the-review.md)

## Context

[ADR 0063](0063-review-classification-as-a-gate.md) removed the screenshot requirement from changes that alter no rendered page. For `visual` and `visual_and_code` everything stayed as it was: a browser session opened the running preview and the customer's live site, captured `REVIEW_POLICY.route = "/"` at 1440×1000 in each, stored two PNGs, and *that pair* was what an approval bound to.

The preview it photographed is the whole running application — every route, any viewport, clickable, scrollable. Vibe was paying a second provider to turn that into two pictures of one route, and then treating the pictures as the evidence a person decided from. The comparison is a strictly poorer instrument than the thing it was a comparison *of*.

There is a second, quieter problem. A screenshot approval bound to images and not to code. Two commits can render identically — a changed dependency, a changed API call, a changed price behind an unchanged button — and the approval said nothing about any of it.

## Decision

**A `visual` change is approved on the preview session plus the code diff.**

```
visual, visual_and_code   →  code_review_digest + preview_session_id
code                      →  code_review_digest
(historical)              →  review_artifact_id
```

**The `preview_sessions` row is what an approval binds to**, not the sandbox. The sandbox is gone in fifteen minutes; the row is immutable and permanent, and it says: an interactive preview of *this exact commit* ran and became reachable at `ready_at`, under a named `preview_policy_version`. That is a weaker claim than "you can look again" and the product does not pretend otherwise — but it is a durable, immutable artifact identity, which is what rule 67 requires.

**The evidence is chosen from server state, never from the client.** A caller names a prepared change; `findReadyPreviewForCommit` finds a session for the same project, the same change, the same commit, with `ready_at` set. A session of a different commit is a preview of different bytes. A session that never answered is not something anybody looked at. Missing either way: `approval_preview_required`, which asks for the thing that is actually missing.

**The earliest ready preview, not the newest.** Every ready preview of one commit served identical bytes, so any of them is equally true evidence — which makes the choice a question about stability. Newest-first would silently move what a new approval binds to, and invalidate a standing one, because a person started a second preview to look again. Rule 68: they did not change their mind, they scrolled the same page twice.

**The diff is in every new form.** A preview shows what a change looks like; only the diff shows what it does. So a visual approval binds to strictly more than it did before this decision, not less.

**An undeterminable classification takes this path too.** Before, `null` fell back to the comparison, which was the stricter choice at the time. Nothing creates a comparison now, so that fallback would make an unclassifiable change permanently unapprovable. The stricter *available* path is diff plus preview, and that is where `null` goes (rule 44).

**The screenshot path is unreachable, not deleted.** `startChangeReview` and `changeReviewWorkflow` still exist and no screen, gate or server action reaches them — the action that could start one is removed rather than left as a callable endpoint. `getReviewCard` and `getReviewImages` stay so a historical approval can still show what it rested on. Deletion is a later slice, once the last artifact has passed its seven-day retention.

**The retention sweep moves to preview teardown.** It was the last step of the review workflow, and a workflow nothing starts sweeps nothing. Preview teardown runs for every preview, already holds the service-role client the bucket's policies need, and is an operation the customer caused — so no scheduler is introduced (rule 24).

**The "before" half is a link to the customer's live site, labelled as it is now.** No capture, no browser session, nothing stored. It says *now* rather than *before*, because production may have moved since the change was prepared and calling it "before" would quietly make the comparison a claim about the base commit — the same honesty ADR 0017 §4 pinned for the screenshot it replaces.

## Consequences

**One paid step disappears.** No browser session per visual review, and `review_browser_usage` gains no new writers. The preview's own sandbox cost is unchanged — it was already being paid, and the screenshot was on top of it.

**What is lost, plainly.** The before/after is no longer conserved: fifteen minutes after the preview ends there is nothing to look at, where two PNGs used to survive for seven days. What survives is the row saying a preview ran, and the diff, which regenerates indefinitely. A person who wants to look again starts another preview.

**A stronger binding, and a stricter one.** Every new approval now names the code, and a visual one also names a preview of the same commit. The old form named neither the code nor a route the person may never have opened.

**The database holds the shape.** Three constraints, admitting exactly three rows and no fourth: exactly one of artifact/digest; a preview never without a digest; and the diff alone only for a `code` change. The insert policy checks whichever form is present — which also repairs a defect from Sprint 0113, where the unconditional comparison clause meant `ra.id = null` matched nothing and the code-diff form would have been refused by RLS in every customer session.

**The merge gate is unchanged and still never asks the classification.** It reads the evidence form off the approval row (ADR 0063 §3, rule 68). ADR 0019's fast-forward-or-refuse, its live re-read and its two-authority rule are untouched.

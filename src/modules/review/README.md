# modules/review

What kind of review a prepared change deserves — see [ADR 0065](../../../docs/decisions/0065-the-preview-is-the-review.md) and [ADR 0075](../../../docs/decisions/0075-the-photograph-nobody-took.md).

This module used to photograph a product before and after a change. It does not any more. [ADR 0065](../../../docs/decisions/0065-the-preview-is-the-review.md) decided that the running preview _is_ the review, and [ADR 0075](../../../docs/decisions/0075-the-photograph-nobody-took.md) deleted the capture path — roughly 1,975 lines, including the browser port, the sandbox capture, the durable workflow and the operation's entry point.

**Nothing here opens a browser** (rule 38). What remains is the question that always mattered more than the photograph: _is a visual review the right instrument for this change at all?_

## The question this module exists to ask

A visual review is good at what it does and cannot ask whether it is the right instrument. Start one for a backend-only change and you get a page that looks exactly as it did: a confident, useless result that looks like a review — and a paid sandbox to produce it.

So `classification.ts` answers the prior question, and only that. It starts nothing, gates nothing and authorizes nothing. It is a recommendation attached to a change that has already been prepared and verified, and it decides from three inputs, all minted or verified by Vibe:

- the changed paths from `prepared_changes.files` — Vibe's own observation of the commit, never the agent's account of it (rule 77);
- the analyzer's resolved execution surface, whose routes each name the repository file that serves them;
- the evidence-derived execution surface requirement.

## Why paths alone were not enough

A real production run on 2026-08-20 changed nothing but an `export const metadata` object in two layout files — adding robots directives — and was recommended for a visual review. Two identical photographs would have been the result. The classifier's own doc comment named that exact failure mode as the thing it existed to prevent, and it happened anyway, **because a path cannot say what inside the file moved.**

`render-impact.ts` closes that by parsing the file with the TypeScript compiler and proving the change _cannot_ have altered rendered output. It claims one direction only: `no_render_impact` means the entire non-metadata program text is byte-identical between the two versions. It never claims the opposite — that a change _did_ alter rendering — because that is not something a parse can establish.

`route-segment.ts` is one regex in its own file on purpose: `render-impact.ts` imports the TypeScript compiler, and the callers that only need "is this a route segment?" should not have to.

## What `review_artifact_available` meant

The gate is still named in the trust pipeline because historical rows carry it:

```
repository_write_verified   the bytes on the branch are the bytes we meant
sandbox_validation_passed   those bytes install, typecheck, test and build
preview_available           that exact artifact runs and is reachable
review_artifact_available   a controlled before/after comparison exists
human_approved              someone looked and decided
merged                      the default branch moved
```

It meant exactly one thing: Vibe captured a controlled representation of the live product and of the prepared preview, so a person could compare them. It never meant the change was good, the design improved, or a merge would be safe. It was evidence _for_ a human decision, never the decision.

`policy.ts` still carries `review-policy-v1` because every number in it — viewport, stabilization CSS, timeouts, retention — is part of what a stored artifact was checked against, and old rows keep their original meaning.

## What lives here

| File                        | Purpose                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `classification.ts`         | Which review a change deserves. Pure, versioned.                                                     |
| `classification-inputs.ts`  | Gathering the three inputs a classification needs from a prepared change.                            |
| `classification-service.ts` | The one entry point application code calls.                                                          |
| `render-impact.ts`          | Proving with the TypeScript compiler that a changed file cannot have altered rendered output.        |
| `route-segment.ts`          | Whether a path is a Next.js App Router route segment. One regex, kept away from the compiler import. |
| `schema.ts`                 | The domain: profiles, statuses, failure codes, and what the gate was allowed to claim.               |
| `policy.ts`                 | `review-policy-v1` — the conditions that made two screenshots comparable.                            |
| `identity.ts`               | The identity an artifact is bound to, and where its images were stored.                              |
| `store.ts`                  | Persistence for `review_artifacts`.                                                                  |
| `storage.ts`                | The screenshot bucket: signing, removal.                                                             |
| `service.ts`                | Reading a stored artifact back — the card, and signed image URLs.                                    |
| `view.ts`                   | Deriving the review card's state.                                                                    |
| `test-support.ts`           | A fake storage double.                                                                               |

## Known dead weight

ADR 0075 deleted the capture path and left its write side standing. `claimReviewArtifact`, `recordCapturedSide`, `recordFailedSide`, `completeReviewArtifact`, `findReusableReviewArtifact` and `putScreenshot` have **no caller anywhere outside their own tests** — not in this module, not in the application. They can no longer be reached, because nothing captures.

The read side is genuinely live: `service.ts` still signs and serves the images of artifacts captured before the deletion, and `removeScreenshots` is still called by the retention sweep in [`operations/change-review/retention.ts`](../operations/change-review/retention.ts). Retiring the writers is a deletion with its own decision to make, not something to do on the way past.

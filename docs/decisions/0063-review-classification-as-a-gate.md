# ADR 0063 — The Review Classification Becomes a Gate

- **Status:** Accepted
- **Date:** 2026-09-01
- **Supersedes:** [ADR 0037 §2](0037-automatic-validation-and-review-classification.md)'s "deterministic and advisory"
- **Amends:** [ADR 0018](0018-human-approval-authority.md) — an approval may now bind to either of two evidence forms
- **Does not alter:** [ADR 0016](0016-temporary-preview-isolation.md), [ADR 0017](0017-visual-review-artifacts.md), or [ADR 0019](0019-safe-approved-change-merge.md)

## Context

[ADR 0037 §2](0037-automatic-validation-and-review-classification.md) built
`classifyReview` — `visual | code | visual_and_code`, computed from three
Vibe-owned inputs with no model call — and deliberately gave it no authority:

> It starts nothing, gates nothing and authorizes nothing.

That was the right shape for a first version, and it left the defect it
described in place. `src/modules/review/` has one profile,
`public_visual_review_v1`, and `approvals/service.ts` required a `ready`
artifact from it before anyone could approve anything. `change_approvals.review_artifact_id`
was `not null`, so the requirement was in the schema as well as in the code.

The consequence, stated plainly: **a change that alters no rendered page could
only be approved after the user paid for a preview sandbox and a browser session
to produce two identical screenshots.** Roughly $0.022 of sandbox plus a browser
session, spent to look at a picture of a page that did not change — and then
presented on the approval screen as the evidence a person decided from. ADR 0037
called that "a confident, useless result that looks like a review" and then
required it.

The second half of the same defect was that the alternative did not exist.
`execution/diff.ts` rendered only added lines, because the one capability that
existed only ever created files. It said so itself:

> A capability that modified existing files would need base-vs-head comparison;
> that is a different capability and a different renderer.

The agent modifies files that already exist. For every change it produces, the
only in-app diff was structurally wrong, and "View code diff" was a link to
GitHub.

## Decision

### 1. The classification decides which evidence a new approval may rest on

An approval names **exactly one** evidence form:

| Classification | Evidence | What it is |
| --- | --- | --- |
| `visual`, `visual_and_code` | `review_artifact_id` | two stored screenshots |
| `code` | `code_review_digest` | the identity of a reproducible diff |
| not determinable (`null`) | `review_artifact_id` | the stricter path, unchanged |

`visual_and_code` deliberately keeps the visual requirement. Half a change being
visible is a whole reason to look at it, and the visible half is the half a diff
cannot show.

`null` is a real answer and means *not determinable* — no repository snapshot,
no connected repository, a failed lookup. It resolves to exactly the behaviour
that existed before this ADR. Missing evidence is never a good result
(CLAUDE.md rule 44), and this is the one place in the change where getting that
backwards would silently remove a gate.

The database enforces both halves, because a TypeScript union and a SQL CHECK
are the same rule written twice with nothing forcing them to agree:

```sql
check ((review_artifact_id is not null) <> (code_review_digest is not null))
check (code_review_digest is null or review_classification = 'code')
```

An approval carrying neither would be a human's yes to nothing; one carrying
both would leave a merge preflight two answers to the question of what was
reviewed.

### 2. A diff is reproducible evidence; a screenshot is not

This is the argument the whole ADR rests on, and it runs the opposite way to
intuition.

`code_review_digest` is `sha256(project, change, base_sha, commit_sha, sorted
paths, diff_policy_version)`. It is **not** a hash of the file contents — those
are never persisted (rule 26) — it is a hash of everything needed to fetch them
again. Two immutable commits under fixed rules produce the same diff, byte for
byte, indefinitely.

A `review_artifacts` row cannot make that claim. Its images expire after seven
days by design ([ADR 0017 §9](0017-visual-review-artifacts.md)), and its
"before" side is *the live product as observed at capture time* — production has
moved on and the comparison can never be regenerated.

So a code-diff approval binds to **stronger** evidence than a visual one, not
weaker. That is what makes this compatible with rule 67 rather than an exception
to it.

### What the digest does not claim

That anyone read the diff. It records what was **shown** — precisely the claim,
and precisely the limit, that a review artifact carries about two images. Nothing
in this product can establish that a human read something, and inventing a field
that implied it would be worse than not having one.

### 3. The classification is pinned onto the approval, and the merge gate never re-asks it

`review_classification` and `review_classification_policy_version` are stored on
the row.

They have to be, because the classification is not stable over time: it reads the
repository analyzer's resolved surface, and a newer snapshot can reveal that a
changed file serves a route. A change that needed only a diff on Monday can need
a visual review on Tuesday, with nothing about the change itself having moved.

That is fine for *creating* an approval — the question is "what would a new
approval need?", and it should be asked against current knowledge. It is not fine
for *finding* one. `findActiveApprovalForCurrentArtifact` therefore reads the
evidence form off the approval row and recomputes the identity around it.
Everything else — commit, base, validation run, policy version — is still
re-derived from current state, so a regenerated commit or a newer validation ends
an approval's applicability exactly as before.

Had the merge gate recomputed the classification, a real, standing, unrevoked
human approval would simply have stopped being found, and the merge would have
been refused on the strength of a route table the approver never saw. Rule 68
forbids exactly that: **repository drift after an approval never rewrites what a
human decided.**

Where the requirement genuinely does change, it is recorded rather than
disguised: a fourth invalidation reason, `review_requirement_changed`, because
telling a user their comparison was superseded when they never had one is a
sentence they cannot act on.

### 4. A real diff, read at two pinned commits

`execution/diff.ts` now reads both versions of every changed file — at
`prepared_changes.base_sha` and `prepared_changes.commit_sha`, through the same
bounded reader the analyzer, the candidate extractor and the classifier already
use. Never at a branch name: a branch is a moving pointer, and a review is about
two exact commits.

`diff-lines.ts` is a line-level LCS, written rather than installed. A dependency
is infrastructure and infrastructure is a recorded decision (rule 3); this is one
file with no runtime, no transitive tree and no way to reach the network, on the
exact path that renders untrusted customer source.

Nothing is persisted, and nothing is parsed. `20260818210000_agent_execution.sql`
already recorded the rule — *deliberately absent: prompts, model output,
reasoning, source files, diffs* — and the renderer is `<pre>` with string
children: no `dangerouslySetInnerHTML`, no syntax highlighter (highlighting means
parsing repository text and emitting markup built from it), no remote assets.

**`deleted` is not a file status.** The GitHub writer refuses deletions, and
`getTextFile` returns `null` for an absent file, a binary one and an oversized
one alike — so a missing head side cannot be *told apart* from a deletion. It is
reported as `unreadable`. `candidate.ts` records making the opposite mistake
once: an oversized build artifact read as the agent removing a repository file.

### 5. What this does not extend to

- **No review is auto-started.** ADR 0037's rule stands: nothing in
  `src/modules/review/` is automatic, because a browser session costs money by
  the second.
- **Preview and visual review are untouched.** ADR 0016 and ADR 0017 are
  unchanged. What changed is *when they are asked for*.
- **The merge write is untouched.** ADR 0019's fast-forward-or-refuse, its live
  revalidation, and its two-authority requirement are all exactly as they were.
- **`code` does not skip validation.** The only gates this removes are the visual
  ones. Nothing reaches a person before the bytes are known to build.

## Consequences

**Easier.** The common case gets cheaper and more honest at once. A backend
change costs no preview sandbox and no browser session, and the screen shows the
thing a person actually needs — what changed — instead of two identical pictures.

**Harder.** There are now two evidence forms where there was one, and two is the
number at which they can disagree. Three things hold them apart: a tagged
identity component so a diff digest can never hash to a review artifact's
identity, two database CHECKs, and the rule that the merge gate reads the form
off the row rather than deciding it again.

**Newly load-bearing.** `classifyReview` was advisory and is now a gate, so its
false negatives cost something they did not before. A path wrongly classified
`code` gets no visual review. The mitigations are structural rather than
promised: the route table is consulted first and is the analyzer's own conclusion
about this specific repository; the structural fallback is a *positive* test, so
anything unrecognised falls through to `code`… which is the direction that
*removes* a visual review. That asymmetry is the residual risk, it is recorded
here rather than argued away, and `visual_and_code` existing at all is what keeps
a mixed change on the stricter side.

**Foreclosed.** Nothing. A project with no repository snapshot classifies as
`null` and behaves exactly as it did before this ADR.

## Related

- [0037](0037-automatic-validation-and-review-classification.md) — built the classification and made it advisory. §2's advisory clause is superseded; §1's validation hand-off is untouched.
- [0018](0018-human-approval-authority.md) — what an approval binds to. Amended here by one field.
- [0019](0019-safe-approved-change-merge.md) — how a merge is authorized. Unchanged, and §3 above is why.
- [0017](0017-visual-review-artifacts.md) — the screenshot comparison, and §8's reasoning about why it outlives the preview it photographed.
- [0036](0036-risk-adaptive-validation-depth.md) — the sibling deterministic classifier, whose presentational path set this one follows.

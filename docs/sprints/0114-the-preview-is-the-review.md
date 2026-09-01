# The five minutes before you could look, and the screenshot that blocked you afterwards

**Recorded 2026-09-01, after the work.** One slice in two cuts: make the preview startable before validation ([ADR 0064](../decisions/0064-preview-before-validation.md)), and make it the evidence a visual approval binds to ([ADR 0065](../decisions/0065-the-preview-is-the-review.md)). Continues [Sprint 0113](0113-review-classification-as-a-gate.md), which gave the classification authority and left `visual` exactly as it was.

No new dependency. No browser automation. No change to how a merge is authorized.

## Two defects, one shape

**The preview came too late.** It restored the filesystem snapshot a *passing* validation captured, and validation's last step is the build. Measured on this repository: install 18s, typecheck 79s, test 84s, build 99s — roughly **290 seconds during which the code was finished and nothing could be looked at**. Then the preview paid again, in snapshot restore and an integrity recheck of the restored tree.

**The screenshot was a second paid step for a weaker claim.** `public_visual_review_v1` photographed one route (`REVIEW_POLICY.route = "/"`) at one viewport (1440×1000). The preview it photographed was the whole running application — every route, any width, clickable. Vibe paid a browser session to turn something rich into something poorer, and *the poorer thing* was what blocked approval.

Both are the same shape: a claim about evidence that cost more than the evidence was worth.

## What was built

| | |
|---|---|
| `change-preview/commands.ts` | `next dev` on an exposed port, with the reversal of [ADR 0016](../decisions/0016-temporary-preview-isolation.md) §7 named in the docblock rather than performed quietly |
| `change-preview/orchestrator.ts` | `provisionPreviewWorkspace` — clone the pinned commit, verify HEAD, scrub the credential and *verify its absence*, install, then close the network. Restore and integrity recheck deleted |
| `change-preview/{schema,identity,service,view,budgets}.ts` | `nextjs_dev_preview_v1`, `preview-policy-v2`, identity keyed on the commit that was served, health budget 180s for the first-request compile |
| `operations/change-preview/{workflow,execution}.ts` | two durable steps: provision, then start-and-probe. A `SandboxProcess` cannot cross a step boundary |
| `validation/orchestrator.ts` | `captureValidatedArtifact` deleted — 144 lines, one snapshot, and 24 hours of a customer's file tree at the provider |
| `approvals/*` | a third evidence form: `code_review_digest` + `preview_session_id` |
| `change-preview/store.ts` | `findReadyPreviewForCommit`, **earliest** ready session, and why that matters below |
| `operations/change-preview/teardown-execution.ts` | the screenshot retention sweep's new home |
| migrations `20260901140000`, `20260901160000` | preview decoupled from validation; the third evidence form, three CHECKs, and a rewritten insert policy |

## The four decisions worth reading

**A preview needs its own sandbox, and that is a provider fact rather than a preference.** `ports` is settable only at `create()`; `applyNetworkPolicy` governs egress and `publicOrigin(port)` only reads a route. Sharing validation's sandbox would mean exposing unchecked code on a public URL from the first second, and `cleanupSandbox` would kill the server seconds after it started. So the preview runs beside validation, and the validation sandbox is untouched: no ports, `deny_all` before any repository-controlled command.

**"Available earlier" is not "started automatically".** ADR 0016 §4 makes the confirmation of public exposure server-side and load-bearing, and rule 60 forbids spending on a user's behalf. So the change is that the button is *offered* as soon as the change is prepared, rather than disabled for five minutes. Nothing starts on its own.

**The earliest ready preview, not the newest.** Every ready preview of one commit served identical bytes, so any of them is equally true evidence — which makes the choice a question about stability, not truth. Newest-first would mean that starting a second preview to look again silently changes what a new approval binds to and invalidates a standing one. The person did not change their mind; they scrolled the same page twice (rule 68).

**An undeterminable classification now requires a preview.** Before, `null` fell back to the comparison, which was then the stricter path. Nothing creates a comparison any more, so that same fallback would have made an unclassifiable change **permanently unapprovable** — a rule-44 fallback that quietly becomes a dead end. It routes to diff-plus-preview, which is the stricter path that can still be walked.

## The defect this sprint found in the last one

`change_approvals`' insert policy has required a `ready` review artifact since Sprint 11B:

```sql
and exists (select 1 from public.review_artifacts ra
            where ra.id = change_approvals.review_artifact_id and …)
```

Sprint 0113 made `review_artifact_id` nullable and added the code-diff form without touching that policy. `ra.id = null` matches no row, so `exists` is **false, not vacuously true** — a code-only approval would have been refused by RLS in every customer session.

It passed everything. The domain tests use the in-memory database, which models CHECK constraints and not policies. The SQL constraint tests insert as the table owner, where RLS does not apply at all. The browser tests run on fixtures. Three green layers and the one that mattered untested — rule 69's named failure mode, found here only because this sprint had to rewrite the same policy.

The new suite runs its inserts as `authenticated`, and the first assertion in it is the form Sprint 0113 could not insert.

## What the tests caught

**`workspace.test.ts` caught a read that ignored its own guard.** The production URL for the "before" link was added to the top-level `Promise.all`, so a project with *no* prepared changes asked the database for a project and a repository connection to fill a field on zero cards. Guarded like the read beside it.

**`approval-ui.test.ts` caught the word "live".** The suite that stops a deploy affordance appearing anywhere on the project page fired on "Open your live site now" — correctly, by its own rules. The link is to the customer's own site and starts nothing, so it is on an allow list of one, scoped to the exact string, with the argument written where it applies rather than by loosening the pattern.

**The migration test caught the RESTRICT edge behaving.** `change_approvals.preview_session_id` is `on delete restrict` between two tables that both cascade from `projects` — the shape ADR 0056 exists about. Deleting a project through `erase_project_lifecycle` with a preview-backed approval works, and it is asserted rather than reasoned about, because if it did not, a customer who had approved one visual change could never delete their account.

## Verification

| Layer | Result |
|---|---|
| Domain (`pnpm test`) | 411 files, 7,083 tests |
| SQL/RLS (`pnpm db:test`, real PostgreSQL) | 14 files, 196 tests — 13 new, all of the policy ones as `authenticated` |
| Browser (Playwright, chromium) | 420 tests, 7 new, two new fixtures |
| `pnpm lint`, `pnpm build` | clean |

**Not dogfooded.** Rule 69's fourth question is open, and this sprint is one where it matters more than usual because it changes what happens *inside a sandbox*. Three assumptions are reasoned and unobserved: that `next dev` starts under `deny_all` with an exposed port, that the first-request compile fits the 180-second health budget, and that the public route for port 3000 exists with no prior build. One real run against a real repository answers all three or none. Recorded in [ROADMAP.md](../ROADMAP.md).

**One environment note, unchanged from last sprint.** `pnpm test:e2e` cannot launch in this container: Playwright expects `chromium_headless_shell-1234` and the image carries `-1194`. The suite passes in full when pointed at the browser that is present.

## What this deliberately did not do

- **No second sandbox on `baseSha`.** "Before" is the live production site, linked and labelled *now*. A base preview would be the more honest comparison and a second clone-plus-install per change; it stays a separate slice if the link proves insufficient.
- **No screenshot code deleted.** Unreachable for new changes only, so a historical approval can still show what it rested on. Deletion waits until the last artifact has passed its seven-day retention.
- **The merge is untouched.** ADR 0019's fast-forward-or-refuse, its live re-read and its two-authority rule are exactly as they were.
- **Validation stays a hard gate on approval.** A preview lets somebody look earlier. It never lets them decide earlier.

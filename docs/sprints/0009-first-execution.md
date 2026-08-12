# Sprint 9 — First Execution

Status: **Complete.** Vibe has written code to a real repository — one branch, one commit, two files, verified by read-back. The default branch was never touched.
Branch: `feat/first-execution`

| Phase | Scope | Status |
| --- | --- | --- |
| **9A** | Safety core: capability resolution, preflight, premise revalidation, path allowlist, deterministic generator, atomic writer | Complete |
| **9B** | Backend wiring: `prepared_changes`, execution identity, `change_preparation` operation, durable workflow, application service | Complete |
| **9C** | Product flow: capability-aware UI, confirmation, durable status, blocked-state UX, bounded diff review | Complete |
| **Dogfood** | One real preparation against `TobiB1505/Vibe-Business` | Complete — see below |
| **Refinement** | Generator v2: conservative sitemap selection, after reviewing what the dogfood produced | Complete |

Sprint 9 does **not** include repository build or test execution, runtime
validation, preview environments, merge, or deploy. None of those exist.

## Goal

The first controlled transition from *"Vibe tells you what to do"* to *"Vibe prepares the change for you"*: one supported, deterministic code change on an isolated GitHub branch, after revalidating that the opportunity's premise is still true.

Not general autonomous coding. Deliberately narrow, deterministic, evidence-verified and reversible.

## Why execution starts narrowly

Sprint 8 produced the argument for this sprint's entire shape.

The repository analyzer reported `robots: detected: true`, citing `src/modules/live-product-intelligence/robots.ts` — our own crawler's robots.txt **parser**. The audit believed it. The Opportunity Engine reasoned validly from it and told the founder to "restore" files that did not exist. Every layer worked correctly; the premise was false.

Advice built on a false premise is a wrong sentence. **A repository write built on a false premise is a wrong commit.**

So execution does not inherit the evidence chain's confidence:

> `executionReadiness === "ready"` authorizes nothing.
> Stored evidence ids authorize nothing.
> Only current, independently re-checked state authorizes a write.

## Execution preflight

`src/modules/execution/preflight.ts`. Pure and port-injected, so every refusal is a unit test rather than a production incident.

| Check | Source of truth | Block reason |
| --- | --- | --- |
| Capability exists | structured opportunity + snapshot | `unsupported_opportunity` |
| Framework supported | repository intelligence | `unsupported_framework` |
| Audit current | today's evidence identity | `stale_audit` |
| Opportunity set current | the audit it derived from | `stale_opportunity` |
| Snapshot current | newest successful snapshot | `stale_repository_intelligence` |
| Repository unchanged | **live GitHub HEAD** | `repository_changed` |
| App root resolvable | repository intelligence | `unsupported_repository_layout` |
| Production origin verified | project configuration | `missing_required_context` |
| Routes still unserved | **live production origin** | `premise_no_longer_true` |
| Target files still absent | **live repository tree** | `conflicting_files_exist` |
| Write permission | **live installation token** | `github_write_permission_required` |

The four bold rows are the premise revalidation. They are the ones that would have caught Sprint 8.

## Capability resolution

`nextjs_seo_foundations_v1`, resolved structurally — never by matching the opportunity's prose.

The tempting implementation is `title.includes("SEO")`, and it is the worst available: the title is model output, so a prompt improvement or a translation would silently change which opportunities Vibe writes code for. **Model wording is not a machine API.**

Two tests state the property directly: a German rewording of the same structure still resolves; the exact English wording without the supporting evidence does not.

## GitHub permission boundary

Minimum required permission, confirmed against current GitHub documentation: **`Contents: write`** — it covers blobs, trees, commits and refs.

Deliberately *not* requested: Pull Requests (no PR this sprint), Administration, Actions, Issues, Secrets.

The installation's actual granted permission is read from the installation token at preflight time, not assumed from what was requested at install. An installation approved under Sprint 2's read-only scope is still live and must be told to upgrade rather than allowed to fail mid-write.

## Deterministic change generator

No model call. No thinking tokens. **No AI cost.**

That is the point: this sprint proves opportunity → preflight → GitHub write → review, without simultaneously proving that an AI can write code. Two different risks; mixing them would make a failure impossible to attribute.

Output is a pure function of `(origin, appRoot)` following the Next.js 16.3.0 App Router metadata-route conventions (`MetadataRoute.Robots`, `MetadataRoute.Sitemap`), checked against current documentation rather than recalled. The sitemap is deliberately conservative: public routes only, nothing behind authentication, nothing internal.

## Branch and commit safety

One atomic commit through the Git Data API: blobs → tree (based on the base tree) → commit (base as sole parent) → **new ref last**. A failure anywhere earlier leaves garbage-collectable loose objects and no branch, which is far better than a half-written one.

Three things the writer structurally cannot do:

- **move an existing ref** — only `createRef`, never `updateRef`, so the default branch cannot be touched by any path in the module;
- **force** anything — `force` is never passed;
- **delete or rename** — the tree is built additively.

Success is not "GitHub returned 201": the branch is re-read, and every file is fetched back from that branch and hashed against the generated bytes.

## Path safety

Two independent defences, because one is a policy and the other is a proof:

1. the generator composes paths from a resolved app root plus fixed basenames, so no caller-supplied string reaches a path;
2. every path is re-checked against a capability allowlist before writing, so a future capability that forgets rule 1 still cannot escape.

Permanently forbidden: `.github/`, `.env*`, manifests, lockfiles, `supabase/`, `next.config.*`, `middleware/proxy`. Absolute paths, traversal and backslashes are rejected outright rather than normalized.

## Tests and mutation validation

50 execution tests. Six mutations, each breaking real tests:

| Mutation | Result |
| --- | --- |
| Remove the HEAD consistency check | 1 test fails |
| Remove the staleness blocks | 2 fail |
| Trust stored evidence instead of the live premise | 3 fail |
| Remove existing-file protection | 2 fail |
| Allow arbitrary target paths | 11 fail |
| Resolve capability by title text | 2 fail |

Per §43, these are only called safety coverage because they demonstrably fail under mutation.

## Backend wiring (9B)

### PreparedChange persistence

`prepared_changes` stores references, never content: branch, base sha, commit sha, file paths and hashes. The GitHub branch is the canonical artifact, so Supabase does not become a source-code mirror (§2, §23). No tokens, no API responses, no diffs, no generated source.

A successful prepared change is immutable — the transitions are scoped to `preparing`, so a replayed persistence step reports that it did nothing rather than rewriting a finished result with a second commit.

### Execution identity

`project + opportunity set + opportunity + capability + capability version + repository snapshot + base HEAD sha`.

The base sha earns its place: a prepared change is a commit *on top of a specific parent*. If the default branch moved, the previously prepared change is no longer the same change even though the opportunity is unchanged — reusing it would hand the user a diff against a tree that no longer exists.

Opportunity prose is deliberately absent. It is model output, so a reworded title would otherwise invalidate a perfectly good prepared change and buy a second branch for nothing.

### Durable operation

`change_preparation`, the third type on the Sprint 7 foundation. Stages: `preflight → generating_change → writing_repository → verifying_repository → persisting → completed`. Two durable steps; the write step sets `maxRetries = 0`, because a platform retry could create a second branch and the recovery path — not the platform — is what makes re-entry safe.

`operation_runs` gained `subject_id`: the domain object an operation acts on. A preparation acts on one specific opportunity, and the workflow must re-resolve exactly which one — not "the current top opportunity", which could be a different one by the time the step runs.

### Application service

The caller decides **a project and an opportunity**. That is the complete list.

The repository, installation, branch, base commit, file paths, capability, production origin and generated content are all resolved server-side. Those are not parameters that get validated; they are not parameters at all, which is what stops a scoped capability becoming an arbitrary write primitive.

### Workflow-time revalidation

The service's eligibility check is a *courtesy* — it avoids queueing an obviously doomed run. **The safety boundary is in the workflow**, immediately before the write, because a queued operation can sit while the repository moves, a teammate adds the files, or the site starts serving them.

HEAD and write permission are re-checked in the write step specifically, not only at preflight, and a test proves each: preflight passes, the world changes, the write step refuses with zero mutating calls.

## Tests and mutation validation (9B)

180 tests across the execution and operations modules. Six new mutations, each breaking real tests:

| Mutation | Result |
| --- | --- |
| Remove active-operation reuse | 1 test fails |
| Remove successful PreparedChange reuse | 1 fails |
| Remove recovery branch inspection | 3 fail |
| Remove workflow-time HEAD revalidation | 1 fails |
| Remove the write-permission gate | 1 fails |
| Let persistence replay create duplicates | 2 fail |

Two of those — active-operation reuse and persistence replay — **survived the first run**. The database constraint covered the first, and the early-return path made the second unreachable. Both got a dedicated test rather than a shrug, which is the entire reason for running mutations against your own suite.

`inspectExistingBranch` was explicitly untested in 9A and now has five cases: absent, exact match, different content, missing file, single-byte difference.

## Product flow (9C)

### Capability-aware opportunity UI

The card's execution affordance is derived server-side from **capability**, not from the model's readiness label. `executionReadiness === "ready"` on an opportunity Vibe has no executor for renders nothing — a button that looks like capability and produces a failure is the worst kind of product lie.

States: `preparable` · `already_prepared` · `preparing` · `failed` · `blocked` · `needs_user_input` · `not_automated`. An active operation suppresses a second start; an existing prepared change offers review instead of a write, exercising the 9B reuse semantics rather than duplicating them.

### Confirmation

Two clicks. The dialog states that Vibe will create an isolated branch and commit, that the default branch and production site will not change, and — deliberately — that **the user's own CI, preview deployments or GitHub automation may react to the new branch**. Claiming "nothing external can happen" would be false, since branch creation triggers whatever the customer configured.

The confirmation is load-bearing, not decorative: the action refuses any submission without the confirmation flag, so a stray POST cannot start a preparation.

### Refresh flow — the one deliberate inline action

`repository_changed` offers **Refresh product intelligence** inline, because that operation is deterministic and costs nothing.

Everything paid stays a separate, explicit decision. A repository refresh never chains into an audit, and an audit never chains into opportunity generation. The blocked-action map encodes this: `stale_audit → update_audit`, `stale_opportunity → refresh_opportunities`, each its own user action. No hidden spend.

### Bounded diff review

The GitHub branch is canonical; the diff is fetched on demand and never persisted. Limits: 10 files, 64 KB per file, 256 KB total, 500 lines per file — applied even though this capability writes two small files, because a bound's value is that it holds when the assumption behind it stops being true.

The branch and paths come from the stored prepared change, so a caller cannot read an arbitrary ref. Content is returned as plain text lines and rendered in a `<pre>` through React's escaping: no `dangerouslySetInnerHTML`, no markdown-with-HTML, no highlighter that evaluates input.

### Prepared change UI

*Change prepared* · **Not merged · Not deployed · Not runtime-tested**, plus review and *Open branch on GitHub* (URL built from stored linkage). No merge, deploy or approve affordance exists.

## 9C tests and mutation validation

1280 → 1331 tests. Four new mutations, each breaking real tests:

| Mutation | Result |
| --- | --- |
| Unsupported opportunity gets an active button | 2 tests fail |
| Active operation fails to suppress a second start | 2 fail |
| Existing PreparedChange fails to suppress a second start | 1 fails |
| Diff authorization removed (project filter dropped) | 1 fails |

The first attempt at the diff mutation was written badly — it kept the same filter through a fallback, so it proved nothing. Rewritten to actually drop the `project_id` predicate, it fails as it should. A mutation that does not mutate is worse than no mutation, because it reports confidence it has not earned.

## The dogfood — 2026-08-12

One preparation, run from the deployed product against this repository.

| | |
| --- | --- |
| Branch | `vibe/seo-foundations-cc32273131c5` — the only `vibe/` branch in the repository |
| Commit | `2f05958e3410deaeb97029861abc05889139b4a7`, author `vibe-business[bot]` |
| Parent | `528d372b81cf28786edcba7d6384f9f74e55ba33` — the analyzed base |
| Files | `src/app/robots.ts` (+20), `src/app/sitemap.ts` (+32), both `added`, zero deletions |
| Capability | `nextjs_seo_foundations_v1` / `nextjs-seo-foundations-v1` |
| Duration | 9.0s write, 15.9s operation total |
| AI calls | **0** |
| Cost | **$0** |
| Default branch | `main` still at `528d372` — never written to |

Verified independently of the product's own report: both files were downloaded from
GitHub and hashed, and both matched the `contentHash` values recorded in
`prepared_changes` byte for byte. That is what makes `repository_write_verified`
a claim rather than an assertion.

### What the dogfood cost before it worked

Three preparations failed first, all at `missing_required_context`, all before any
write. The cause was a plain bug: the workflow's `resolveTarget` queried a table
named `project_repositories`, which does not exist. No test could catch it, because
every workflow test injects `resolveTarget` as a fake — the seam that makes the
workflow testable is exactly the seam the bug lived in. Fixed in #23 by reusing
`getProjectWithRepository`, the same function the rest of the application uses.

The second half of #23 was a UI defect the same run exposed: a failed preparation
re-offered the start button, because the project page passed `failedOperation: null`
instead of querying for one.

Merging #23 then moved `main` past the analyzed snapshot, so the next attempt
blocked on `repository_changed` — correctly, and at our own expense. Clearing it
required a repository refresh (free) plus a re-audit and regenerated opportunities
(~$0.12). Worth recording plainly: **staleness blocking costs real money on a
repository that moves as fast as its own analyzer.** For a customer product that
changes weekly this is invisible; for this repository it is not.

### What the regenerated opportunity proved

The SEO opportunity survived regeneration with different wording — "Add missing
technical SEO foundations", where the earlier set said "Fix missing…" — and still
resolved to the same capability. Capability resolution reads evidence and
structure, never prose, so a reworded model output routed identically. That is
the property `capabilities.ts` exists to guarantee, tested in the unit suite and
now observed on genuinely regenerated production data.

## Post-dogfood refinement — SEO generator v2

The dogfood result above is unchanged and stands as recorded. What follows
happened *after* it, in response to reviewing what it produced.

### What review found

The generated sitemap listed `/`, `/login` and `/signup`.

No safety invariant failed. The preflight refused correctly four times, the
write went to an isolated branch, the read-back matched the recorded hashes byte
for byte, and the default branch was never touched. Vibe wrote exactly what it
intended to write.

**The intent was wrong.** A sitemap is a public invitation to index, and
inviting a crawler to index a login form is not a thing anyone asked for. This
is the distinction the sprint had claimed in the abstract and now had a concrete
example of: `repository_write_verified` means the write was correct, not that
the content was good. Human review is a separate gate, and it earned its keep on
the first change that ever passed through it.

### What changed

`nextjs_seo_foundations_v2` — a new capability, not an edit to v1.

Sitemap entries are now selected by `generators/route-classification.ts` from
structured route intelligence: the site root, plus static `page` routes outside
every known authentication, account, application, API and administrative
surface. Dynamic routes are omitted because `/blog/[slug]` is a template, not a
URL, and resolving it would mean reading customer data this capability does not
touch.

For Vibe Business itself the corrected sitemap contains exactly one entry, `/`.
That follows from generic classification, not from anything hard-coded: the
product's other routes are `/login`, `/signup` and `/app/*`.

`/signup` is excluded **as V0.1 policy, not as an SEO law**. Signup pages are
sometimes indexed deliberately. Vibe does not yet hold the business context to
make that call, so it declines to make it rather than guessing. A later
capability can revisit this knowing it was a decision.

### What deliberately did not change

Robots rules. Omitting a route from a sitemap says "we are not asking you to
index this"; a robots `disallow` says "do not fetch this at all". Those are
different claims, and conflating them is how a generator quietly breaks a
customer's site. `robots.ts` still disallows only `/app/` and `/api/` —
authentication routes are excluded from the sitemap but remain crawlable (§10).

Capability scope is also unchanged: two files, `robots.ts` and `sitemap.ts`, in
the resolved app root. No metadata, canonical tags, Open Graph, structured data
or redirects.

### Versioning

v1 remains declared and remains permitted by the database. The `prepared_changes`
row for `2f05958` carries it, and that row must keep describing what was
actually written. Old rows were not migrated and history was not relabelled —
**v2 did not produce the first dogfood commit, and the record says so.**

Capability and generator version both feed the execution identity, so a
re-preparation of the same opportunity, snapshot and base commit under v2
computes a different identity and a different branch. Without that, the user
would be handed the old branch — still containing `/login` — as though it were
the corrected change. Pinned by `identity.test.ts`.

### A migration was required after all

The task assumed none would be. That was wrong, and the way it was wrong is the
interesting part.

`prepared_changes.execution_capability` carried
`CHECK (execution_capability = 'nextjs_seo_foundations_v1')`. The v2 bump passed
lint, typecheck, build and 1376 unit tests while every real preparation would
have failed at INSERT. The in-memory test database does not evaluate CHECK
constraints, so no behavioural test could have seen it — the same shape as the
`project_repositories` bug that cost three failed dogfood attempts: a TypeScript
value and a database rule expressing one thing in two places that nothing forced
to agree.

`20260812150000_prepared_changes_capability_v2.sql` widens the constraint to
permit both. `schema.test.ts` now parses the migrations and asserts the SQL
constraint matches `EXECUTION_CAPABILITIES`, so the next capability cannot drift
the same way.

### No second real write

None was performed. The write path was proven by the dogfood; this refinement
changes which URLs a generated file lists, which is fully determined by tests.
Re-running it would have cost a repository refresh, a re-audit and regenerated
opportunities to prove something the unit tests already prove.

The dogfood branch `vibe/seo-foundations-cc32273131c5` is untouched, and still
contains the v1 output.

### Mutation validation

Nine mutations, each verified to break tests — including two that were not in
the brief and one that initially **survived**:

| Mutation | Result |
| --- | --- |
| auth-route exclusion removed | 16 tests fail |
| `/app/*` exclusion removed | 5 fail |
| sitemap falls back to all public routes | 6 fail |
| capability left at v1 | 5 fail |
| dynamic-route exclusion removed | 2 fail |
| capability/version map drifts | 2 fail |
| API exclusion removed | 1 fail |
| generator ignores its `routes` input | 3 fail |
| `getSnapshotById` drops the `project_id` predicate | **survived → test added → 1 fail** |

The survivor mattered. Reading route intelligence during the write step
introduced a new service-role query, and under ADR 0013 the ownership predicate
is the only thing standing between an operation and another tenant's snapshot,
because RLS is bypassed. It had no test until the mutation said so.

The change-preparation test fake was also corrected: it previously echoed a
module-level fixture back as the branch's file content, so read-back
verification was checking the test's own constant against itself. Blob and tree
contents are now carried through faithfully, which is what lets the end-to-end
sitemap assertions mean anything.

## Known limitations

- No repository execution of any kind: no clone, no install, no build, no tests. Vibe has no sandbox, so a prepared change can honestly be called `repository_write_verified` but never `application_validated`. **The dogfood does not show the generated code is correct — only that the write was safe, deterministic and verified.**
- Nothing in the pipeline judges output *quality*. v2 fixed the one issue review found; it did not add a mechanism that would have found it. Human review before merge remains the only content gate.
- Route classification is a heuristic list of conventional segment names. It can omit a legitimate public page whose first segment happens to look like an app surface — deliberately, since the failure it prevents is worse than the one it causes (§4). It may only ever remove routes, never add one.
- Creating a branch may trigger repository-configured CI or preview automation. Vibe neither triggers nor manages those. The confirmation dialog says so.

## Next step

Not decided. The obvious candidates — preview, merge, deploy — each require an
approval architecture that does not exist, and none should be built on the
strength of one successful preparation.

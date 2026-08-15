# Sprint 12A — Production Outcome Verification

**Status**

| Slice | State |
| --- | --- |
| Outcome contract owned by the execution capability | ✅ Complete |
| `nextjs_seo_foundations_outcome_v1` verifier | ✅ Complete |
| ChangeOutcomeVerification domain, RLS, service, durable workflow, UI | ✅ Complete |
| Safe HTTP observation reusing the Sprint 3 boundary | ✅ Complete |
| Bounded window, early exit, replay safety | ✅ Complete |
| verified / partial / not_observed / failed distinctions | ✅ Complete |
| Tests + 22 deliberate regressions | ✅ Complete (21 killed, 1 mis-targeted and retargeted — see below) |
| Browser E2E of the outcome UI | ✅ 32 chromium tests (20 new + the 12 merge tests, all green) |
| Migration deployed | ✅ Deployed 15.08.2026 via the CLI from the linked machine |
| Real dogfood | ✅ **Done 15.08.2026 — production outcome verified, 8/8 checks, 1 attempt** |

## Goal

Answer exactly one question, for one merged change:

> Did the intended observable product outcome actually appear in the public product after the approved change was merged?

Not "did the business improve". Not "was it deployed". Those are different questions and this sprint refuses to answer either.

## Delivery vs product outcome vs business outcome

```
DELIVERY          did repository state change as intended?      Sprint 11C
                  → `main` points at the approved commit, read back independently

PRODUCT OUTCOME   did the intended public behaviour appear?     ← this sprint
                  → /robots.txt is reachable, the sitemap lists the homepage
                    and does not list the login form

BUSINESS OUTCOME  did traffic / conversion / revenue move?      not built
                  → Sprint 12B, and it needs analytics, a baseline, and an
                    argument about causality that none of this provides
```

They are three fields on the server-decided card and three rows on screen. A verified product outcome is **not** evidence of business impact, and the product says so on every success surface — not as a footnote, as a row in the same table as the tick.

## Why merged ≠ deployed

Vibe controls no deployment provider and reads no deployment API.

Observing `/robots.txt` and `/sitemap.xml` behaving as the merged capability intended is *consistent with* the new build serving. It is not proof, and it carries no provenance for which commit is live — somebody could have written those files by hand.

So the vocabulary is `verified` / `partial` / `not_observed`, never `deployed`, `live`, `released` or `shipped`. `deploymentVerified` is a constant `false` on the card, exactly as on the merge card.

The inverse is refused too. `not_observed` never renders as "deployment failed" — the panel says so explicitly, because it is the conclusion a user reaches unaided:

> This does not mean a deployment failed. Vibe does not read your hosting provider, so it cannot say why the behavior was not visible.

## Outcome contract architecture

The rejected design is a measurement service containing `if (capability === "seo") fetch("/robots.txt")`. It becomes a switch statement that knows the intimate details of every generator and is updated by nobody when a generator changes.

Instead the contract lives with the capability, in `src/modules/execution/outcome-contract.ts`, and is derived from **the generator's own functions**:

```
generateSeoFoundations ─┬─ selectSitemapRoutes      → which public paths it lists
                        └─ excludedSurfacePrefixes  → which private subtrees it excludes
                                    │
                        resolveOutcomeContract      → the expectations
```

`excludedSurfacePrefixes` is new, and it is the half the generator never needed: the generator only had to *omit* those routes, while the verifier has to *assert their absence*. It reuses the same `EXCLUDED_FIRST_SEGMENTS` map and filters to surface reasons only — `authentication`, `account`, `application`, `api`, `administrative`.

That distinction matters. `/blog/[slug]` is left out of a sitemap because a template is not a URL; nobody claimed it must never be indexed. `/login` is left out because advertising a sign-in form to every crawler is the defect v2 exists to fix. Only the second kind is worth verifying, and only the second kind may be reported as *failed* if it shows up.

A test generates the real files and asserts the contract agrees with their contents, so a change to route selection that is not reflected in the contract breaks the build.

**No model is involved.** Not before the merge, not after it. An AI asked to invent success criteria post-hoc would mark its own homework, and the criteria would drift with every prompt revision. An unsupported capability is `outcome_not_supported`, with no AI fallback.

## The SEO outcome profile

`nextjs_seo_foundations_outcome_v1`, derived from what the generator actually emits:

| Check | Reads | Passes when |
| --- | --- | --- |
| `robots_reachable` | `/robots.txt` | 2xx, `text/plain` |
| `robots_declares_sitemap` | `/robots.txt` | declares `<origin>/sitemap.xml` |
| `sitemap_reachable` | `/sitemap.xml` | 2xx, XML |
| `sitemap_parsed` | `/sitemap.xml` | announces itself as a urlset or sitemapindex |
| `sitemap_includes_public_root:/` | `/sitemap.xml` | lists the canonical origin |
| `sitemap_includes_path:<p>` | `/sitemap.xml` | lists each route the generator selected |
| `sitemap_excludes_private_prefix:<p>` | `/sitemap.xml` | lists nothing under `/login`, `/signup`, `/app`, `/api`, … |

Derived per repository: a project with no `/admin` route gets no `/admin` expectation, because a check that can only ever pass inflates the evidence list without adding evidence.

**Two things deliberately not expected:**

- **robots.txt disallowing `/login`.** The generator does not emit that, on purpose and with a comment saying why — omitting from a sitemap and disallowing a fetch are different claims, and conflating them breaks link previews and verification flows. Expecting it would fail a correct product.
- **An exact sitemap URL count.** Production may legitimately be ahead of the merged commit. A verifier that failed on that would be measuring staleness, not outcome.

## Safe HTTP observation

Every request goes through `safeFetch` — the Sprint 3 boundary, unchanged (ADR 0010, CLAUDE.md rule 35). That buys, without re-implementation: scheme and credential policy, DNS resolution with every returned address gated, the connection pinned to the address that passed (so no DNS-rebinding window), per-hop redirect revalidation, streaming byte and timeout budgets, and content-type refusal before parsing.

**This is not a crawl.** Two absolute paths on one origin, taken from the contract:

- no link is followed
- no sitemap entry is fetched
- no sitemap index is walked
- no authenticated route is touched
- no browser, no JavaScript rendering
- the site root is never fetched — *"is the homepage in the sitemap"* is a question about the sitemap

Tests assert the request **count**, not just the behaviour: a sitemap listing four URLs still produces exactly two requests.

The origin is resolved server-side from `projects.production_url` and re-validated through `normalizeProductionUrl`, which refuses HTTP, credentials, internal names and unsafe literals. The client has no parameter in which to name a URL — not because one is rejected, because none exists.

Bodies are parsed inside the observation module and discarded. Nothing above it ever sees HTML, XML, robots text or a URL list, so nothing above it can persist one.

## Observation window

Fifteen minutes, seven attempts at fixed offsets:

```
t=0   30s   60s   2m   4m   8m   15m
```

Front-loaded and then spaced out, because the interesting cases cluster at both ends: an already-finished deployment answers on the first attempt and the workflow exits immediately, while a slow build deserves one patient look near the deadline rather than sixty impatient ones. Worst case is fourteen public GETs.

The deadline is computed once, written to `verification_window_ends_at`, and read back on every attempt. It is never recomputed from `now()` — a replayed workflow that recalculated its own window would extend it on every re-entry, and a fifteen-minute observation would quietly become an unbounded one.

`withinWindow` **fails closed**: a missing or unparseable deadline reads as *expired*, never as unlimited. One observation fewer is a far better failure than a workflow polling somebody's production website forever.

## Retry semantics

Read-only retries are allowed here, and this is the deliberate opposite of the merge:

| | merge | outcome |
| --- | --- | --- |
| The consequential step | `writeDefaultRef` | `observe` |
| `maxRetries` | **0** | **2** |
| Why | a retried write can move a branch twice | a retried GET reads the same public file |

What retries must not do is blur the vocabularies. A transport error is a fact about Vibe's observation and never evidence that the customer's product misbehaves. That distinction is carried in the check statuses themselves:

```
passed        the expected behaviour is present
failed        the document was read and contradicts the expectation
not_observed  the document is not published (yet)
error         Vibe could not read it reliably
```

A 404 during the window is the expected shape of *"production has not updated yet"*, classified as `not_observed`. Folding it into `error` would make every mid-deploy poll a Vibe fault.

## Result classification

```
every check passed                    → verified
nothing passed, everything errored    → failed        we could not look
nothing passed                        → not_observed  it did not appear
otherwise                             → partial       some of it did
```

Three details that are load-bearing rather than incidental:

- **An empty check list is never success.** An unsupported capability with no checks would otherwise verify for free.
- **An absence check over an unpublished sitemap is not `passed`.** A sitemap that does not exist does not demonstrate that private routes are excluded from it. Reporting `passed` would let a completely undeployed product accumulate green checks.
- **An absence check over a *truncated* URL list is `not_observed`.** "We did not find it in the first ten" is not "it is not there" (CLAUDE.md rule 27).

`partial` preserves per-check truth. The failing lines are on screen, never summarised away.

## No hidden spend

| | |
| --- | --- |
| AI calls | **0** |
| Sandbox calls | **0** |
| Browser sessions | **0** |
| GitHub requests (read or write) | **0** |
| Deployment provider calls | **0** — Vibe has none |
| Public HTTP | ≤ 14 bounded GETs |

Opening a project page reads two rows and makes **no outbound request at all** — asserted by a counter in the browser suite, not promised in a comment. Only an explicit click creates an operation.

A `not_observed` result offers no remerge, revalidate, rebuild or redeploy. There is no hidden recovery, and nothing here starts a repository scan, an audit, opportunity generation, a deep scan or a preview (CLAUDE.md rule 60).

No usage ledger row is written. The existing ledger records billed provider work; a handful of public GETs is not that, and inventing a row for it would make the ledger less truthful rather than more complete.

## Database / RLS

`change_outcome_verifications`, one row per question.

The privilege split is the same one Sprint 11C's merge table uses, and for the same reason:

| Statement | Who may |
| --- | --- |
| INSERT | the project owner, through their own session — the policy independently verifies a **merged** merge whose read-back head is exactly this commit |
| UPDATE | **nobody**. There is no update policy, so every authoritative transition is reachable only by the service-role client durable execution holds |
| DELETE | nobody, ever |

So a caller holding an authenticated anon-key token cannot forge `verified`, cannot invent a passed check, cannot claim an observation timestamp and cannot attach itself to somebody else's operation. Not because a code path declined — because no policy permits the statement.

Constraints that carry weight:

- `outcome_verified_has_observations` — a `verified` row must carry results, an attempt count above zero, an observation completion and no failure code. **A mutation that skips observation entirely cannot store a green outcome.**
- `outcome_product_answer_has_observations` — same for `partial` and `not_observed`, which are also statements about what was seen.
- `outcome_failed_has_reason` — `failed` is the one state that may exist without observations, and it must say why.
- `outcome_window_is_bounded` — a deadline that does not follow a start cannot be stored.

Evidence is JSONB, versioned explicitly by `evidence_schema_version` (`outcome-evidence-v1`).

The identity index covers every state **except `failed`**, for the reason `preflight` is excluded from the merge's write lock: `failed` is where a Vibe-side problem lands, and a lock with no release would block that verification forever with no way to clear it through the product.

## Durable execution

Operation type `change_outcome_verification`; stages `observing` and `evaluating`.

```
openWindow ─▶ observe(0) ─sleep─▶ observe(1) ─sleep─▶ … ─▶ conclude ─▶ complete
     │            │                    │                      │
     └────────────┴────────────────────┴──────────────────────┴──▶ abort
```

The ninth operation type on the Sprint 7 foundation, and the first that *waits*. Fifteen minutes is not a request, it is a process — which is precisely why no browser tab holds it open.

Two stages, not seven. `observing` covers the whole window including its sleeps: a stage flickering once per attempt would be a progress bar lying about how much is left, and there is no honest percentage for "is their deployment done yet".

## UI

```
## Outcome

Merged
Not yet verified in production

[ Check production outcome ]
```

While running — no percentage, and an explicit "you can leave this page".

Verified:

```
## Outcome
Production outcome verified

✓ robots.txt reachable
✓ robots.txt points at the sitemap
✓ sitemap.xml reachable
✓ homepage included in sitemap
✓ /login excluded from sitemap
✓ /signup excluded from sitemap

Observed at 14 Aug 2026, 14:52

Merged              Yes
Production outcome  Verified
Business impact     Not measured

This verifies the intended public product behavior. It does not measure
business impact, and Vibe has not verified a deployment.
```

Partial shows the same list with the failing line present, not hidden. Not-observed says what was not seen and explicitly refuses the deployment conclusion. `failed` reads as *"Vibe could not check"*, never as the product misbehaving.

**No confirmation dialog.** The operation is read-only against the customer's own public website and has no side effect to warn about. Copying the merge's ceremony here would teach users to click through dialogs, which is how the one that matters stops being read.

## Browser E2E

20 new chromium tests in `e2e/outcome-ui.spec.ts`, on top of the 12 merge tests, all green:

- merged / not measured → the action is visible, and rendering reached no external host
- observing → running copy, no percentage, no button
- verified → each observed behaviour on screen, plus the ladder
- partial → the failing check is visible and it never reads as verified
- not_observed → honest timeout copy, no hidden recovery
- failed → reads as Vibe's limitation, distinct from not_observed
- every scenario: no "Deployed" badge, no deploy/ship/publish control
- reload recovery for verified and partial
- an unmerged change shows no Outcome panel at all

Same limitation as Sprint 11C.1: the states come from fixtures, so the wiring in `page.tsx` and RLS are still unproven at this layer.

## Tests

2371 tests across 123 files, all green. New: 133 across nine files.

## Mutation validation

22 applied and reverted. **21 killed. 1 mis-targeted by me and retargeted.** Four survived on first attempt and each exposed a real test gap, which was closed rather than explained away.

| # | Mutation | Result |
| --- | --- | --- |
| 1 | unmerged ChangeMerge becomes eligible | killed |
| 2 | client can choose the production origin | killed |
| 3 | first missing endpoint immediately terminal | killed |
| 4 | observation deadline check removed | killed |
| 4b | `withinWindow` treats a missing deadline as unlimited | killed |
| 5 | partial classified as verified | killed |
| 6 | auth-route exclusion dropped from the contract | killed |
| 6b | a leaked auth route reported as passed | killed |
| 7 | double click creates a duplicate verification | killed |
| 8 | migration grants an UPDATE policy (user forges a result) | killed |
| 8b | store lets a terminal verification be re-completed | **survived → killed** |
| 8c | the observation window can be reopened | killed |
| 9 | UI renders "Deployed ✅" | killed |
| 10 | UI claims the change's business impact | killed |
| 10b | the ladder's "Not measured" row becomes "Improved" | **survived → killed** |
| 11 | raw response body persisted as evidence | killed |
| 11b | the sitemap URL list smuggled into an evidence field | **survived → killed** |
| 12 | safe-fetch address gate bypassed | killed |
| 13 | contract derived from the latest snapshot, not the prepared one | killed |
| 14 | frozen expectation ignored at evaluation | killed |
| 15 | view hides non-passing checks | **survived → killed** |
| 15b | view drives its list off results instead of the expectation | killed |
| 16 | an empty check list verifies for free | killed |
| 17 | absence claimed over a truncated URL list | killed |
| 18 | the card claims a deployment was verified | killed |

### The four that survived, and what each one taught

**10b — the ladder's "Not measured" row.** The assertion read the raw source, and the panel's own header comment draws the ladder to explain why it exists. So deleting the row from the JSX left the comment matching. Fixed by asserting over comment-stripped rendered copy — which also caught that JSX wraps prose across lines, so several `toContain` assertions were passing for the wrong reason.

**11b — evidence smuggling.** The existing assertions looked for `<urlset` and `<?xml`. Stuffing the *canonicalized URL list* into the `contentType` field contains neither. The evidence policy was enforced by a type shape and by substring checks, not by anything that bounds what a stored value may be. Fixed with a key allowlist and a 64-character bound on string values, plus an assertion that no path from a fetched document ever appears in a stored result.

**15 — the view hiding failures.** There was no test for the view layer at all: the browser suite renders fixture cards, and the service tests never built a card with mixed results. So the one-line change that turns a partial into a verified by omission was invisible. Fixed with `view.test.ts`.

**8b — the store's terminal guard.** This one is subtler and worth stating precisely. The step-level check in `concludeOutcomeStep` short-circuits before the store is reached, so no workflow-level test could distinguish "the step guard stopped it" from "the store guard stopped it". Under the in-memory database, which cannot express a race, the store guard genuinely *is* redundant — and would have been deleted by anyone tidying up.

It is not redundant in production: a durable step reads, decides and writes as three moments, and the conditional predicate is what makes the decision and the write one act. Fixed by testing the store directly, with a comment saying why the test exists at that layer.

### Reported honestly

**Mutation 14 was mis-targeted on the first attempt.** I emptied `checks` on the argument to `observePublicProduct`, which reads only `publicOrigin` and `resources` — so the mutation was a genuine no-op and survived for a reason that says nothing about the tests. Retargeted at `evaluateObservation`, where the frozen expectation is actually consumed, it is killed. The first attempt is listed here rather than quietly replaced.

## Quality gate

| Command | Result |
| --- | --- |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 2371 tests, 123 files |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 32 chromium tests — see note below |
| `pnpm db:status` | ✅ 22/22, nothing pending, no remote-only drift |
| `pnpm db:lint` | ✅ no schema errors |

Both database commands were re-run from the linked machine after deployment,
together with the whole gate: lint, typecheck, 2371 tests, build and 32 browser
tests all green there against the deployed schema.

**On `pnpm test:e2e`.** This container ships Chromium build 1194 at `/opt/pw-browsers`, while `@playwright/test` 1.62 expects 1234, and `playwright install` is disabled here. The suite was run with an environment-only config in the scratchpad that points the repository's own config at the preinstalled binary — nothing in `playwright.config.ts` was changed, so CI and other machines are unaffected. All 32 tests pass.

**On the Supabase CLI.** The same position as Sprint 11C: this environment has no CLI credentials and no `.env`, so `supabase link` cannot run. Migration alignment was instead verified read-only through the Supabase connection to the `Vibe-Business` project: 21 local migrations, 21 remote, exact version-for-version agreement, no remote-only drift. The live `operation_runs` constraints were read before this migration was written — eight operation types, thirty-two stages, and neither `change_outcome_verification` nor `observing`/`evaluating` present. `schema.test.ts` now pins both representations together.

## Migration — deployed 15.08.2026

Applied from the linked machine through the sanctioned workflow: `pnpm db:status`
→ `pnpm db:push`. One pending migration, no remote-only drift, **version
preserved**. History converged at 22/22.

### The check that was worth doing first

This migration drops and re-adds two `operation_runs` enum CHECKs, and a
drop/re-add can silently *narrow* an enum — orphaning rows that already use a
value the new list forgets. The re-added lists were diffed against the live
constraint before applying:

| Constraint | Live | After | Removed |
| --- | --- | --- | --- |
| `operation_type` | 8 | 9 | **none** — `change_outcome_verification` added |
| `stage` | 32 | 34 | **none** — `observing`, `evaluating` added |

Purely additive, which is what made it safe to apply to a database holding real
operation history.

### Verified live after deploy

- table present, **17 CHECK constraints**;
- **INSERT and SELECT policies only** — no UPDATE, no DELETE, so every
  authoritative transition can only be written by the service-role client;
- `change_outcome_verifications_identity_idx` present;
- Postgres's own normalized `with_check` confirms every reference to the new row
  is qualified `change_outcome_verifications.*` and every inner reference is
  aliased (`p`, `cm`, `orn`) — the scoping bug from migration `20260814101000`
  is structurally absent;
- the insert policy requires a **`merged`** merge whose independently read-back
  head equals the claimed commit.

### The original note, kept

The reasoning below is what made the deployment correct rather than convenient,
so it stays on the record.

#### Why it was not applied from the implementation environment

`supabase/migrations/20260814170000_change_outcome_verifications.sql` is written, reviewed and pinned by contract tests. **It has not been applied.**

The sanctioned path (CLAUDE.md rule 29, [0002a](0002a-supabase-cli-workflow.md)) is `pnpm db:status` → `pnpm db:push` → `pnpm db:lint` from a linked machine, and that machine is not this one.

The obvious shortcut — applying the DDL through the Supabase management connection that *is* reachable from here — was rejected for the same reason Sprint 11C rejected it: that path stamps its own migration version, so the remote history would record a version the local file does not have, and the next `pnpm db:push` would try to create a table that already exists. That is exactly the divergence rules 29, 30 and 34 exist to prevent.

**Until it was deployed, every "Check production outcome" click would have failed at INSERT** on `operation_runs_operation_type_check`, before a single request was made. It has since been deployed, as recorded above.

## Real dogfood — done, 15.08.2026

**Vibe observed a customer's product for the first time.** The customer was Vibe
Business, and the product was serving the change Vibe had merged into it the day
before.

### The answer

`verified` — **8 of 8 checks passed on the first attempt**, in 2.5 seconds.

| Check | Result |
| --- | --- |
| `robots.txt` reachable | ✅ 200 · `text/plain` · 115 bytes · 0 redirects |
| `robots.txt` declares the sitemap | ✅ present |
| `sitemap.xml` reachable | ✅ 200 · `application/xml` · 271 bytes |
| `sitemap.xml` parses as a sitemap | ✅ 1 URL |
| homepage included | ✅ present |
| `/login` excluded | ✅ absent |
| `/signup` excluded | ✅ absent |
| `/app` excluded | ✅ absent |

### The record

| | |
| --- | --- |
| Verification | `b9efb2f7` · `verified` · **one row, total** |
| About | merged commit `78cbdac…` · `nextjs_seo_foundations_v2` |
| Profile · policy · evidence | `nextjs_seo_foundations_outcome_v1` · `outcome-policy-v1` · `outcome-evidence-v1` |
| Origin | `https://vibe-business-fawn.vercel.app` — effective origin identical, **0 redirects** |
| Attempts | **1** of a possible 32 |
| Window | opened `01:45:50`, deadline `02:00:50`, concluded `01:45:53` |
| Operation | `completed` · `change_outcome.started → change_outcome.verified` |
| AI calls | **0** |

The window is the part worth reading twice: `verification_window_ends_at` was
written **once** at open and the run finished 2.5 s later. The deadline was a
property of the record, not of a process that happened to still be running —
which is exactly what §42 asks for and what a replayed workflow would otherwise
quietly extend.

### Independently checked, not taken on trust

Every observation was re-run by hand against production afterwards and compared
to the stored evidence:

```
/robots.txt    200 · text/plain       · 115 bytes   ← matches the record exactly
/sitemap.xml   200 · application/xml  · 271 bytes   ← matches, 1 <url>, /login /signup /app absent
```

This is *not* the manual substitute §47 rules out. The observation happened
through the product flow and produced a traceable verification record; the
by-hand fetch came afterwards, as an audit of whether that record was true. A
verification layer nobody ever checks against reality is a layer that can drift
without anyone noticing.

### What the stored evidence contains

Statuses, byte counts, a normalized content type, redirect counts, booleans, a
URL count. **No response body, no XML, no robots text, and no sitemap URL read
out of a fetched document.** The check that reports `/login` absent stores
`present: false` — not the sitemap it learned that from.

### The three lines the panel refuses to collapse

```
Merged              Yes
Production outcome  Verified
Business impact     Not measured
```

Eight green ticks after a merge is precisely the moment a product invites the
reader to conclude that something improved. The card declines to, and repeats
that Vibe has not verified a deployment — which stays true: Vibe observed a
public URL, it did not observe a deploy.

### The closure

The first Vibe-authored commit, on 12.08., listed `/login` and `/signup` in a
sitemap: correct at every safety layer and wrong in intent. It is the standing
example in this project's history of why `repository_write_verified` is not
`good`.

**Three of the eight checks that just passed in production are specifically that
those paths are absent.** The defect the pipeline was built around is now the
thing the pipeline measures.

### The eligibility that made it possible

Resolved from production data rather than assumed, exactly as §46 requires:

| | |
| --- | --- |
| ChangeMerge | `82e4980e-d077-464e-a06a-e80b50d985ac` · `merged` · **one row, total** |
| Merged commit | `78cbdac32ea660edd20af4a9dfcc74be6c388700` |
| Base | `246ac362610aac828f35fc5dbfa8f67dde5ebbdd` |
| Read-back head | `78cbdac…` — **equals the approved commit** |
| PreparedChange | `1232a8f9-3578-4102-9a4a-bd0266554fb4` · `vibe/seo-foundations-ab0d865476a6` |
| Capability | `nextjs_seo_foundations_v2` |
| Approval | `968f8955-d0f1-4619-ae3f-e2eaa23f12ff` |
| Public origin | `https://vibe-business-fawn.vercel.app` |

Eligibility held on every axis §10 names, and the table to record the answer in now exists.

## Known limitations

- **Only one capability has a verifier.** Everything else is `outcome_not_supported`, stated rather than glossed.
- **No re-check.** A terminal `not_observed` or `partial` is an answer. A deliberate re-check is a future capability, not a hidden button.
- **Fifteen minutes may be too short** for slow pipelines, and there is no way to extend it. A deliberate bound, not an oversight.
- **A `partial` cannot distinguish "the deployment is half done" from "the change is wrong."** Both produce mixed checks. The per-check truth is shown; the interpretation is the user's.
- **No provenance.** Vibe cannot say the observed behaviour came from the merged commit rather than from something a human did in parallel. This is why the word "deployed" does not appear.
- **The observation records only the latest attempt.** Seven attempts of history would be seven times the evidence to justify one answer, and the answer is only ever about the last look — but it does mean a transient flake on the final attempt can turn a would-be `partial` into a `failed`.
- **The browser suite still renders fixtures**, so `page.tsx` wiring and RLS remain unproven at that layer — the fourth sprint carrying this gap.
- **`pnpm db:status` / `db:lint` were not run.** The live constraints were read directly instead.

## Related

- [ADR 0020 — Production outcome verification](../decisions/0020-production-outcome-verification.md)
- [Sprint 11C — Safe Merge](0011c-safe-merge.md)
- [ADR 0010 — Safe outbound HTTP inspection](../decisions/0010-safe-outbound-http-inspection.md)
- [ADR 0013 — Durable operation execution](../decisions/0013-durable-operation-execution.md)

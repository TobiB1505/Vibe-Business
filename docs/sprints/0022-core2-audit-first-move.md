# Sprint CORE-2 — Audit & First Move Activation

**Status: foundation half delivered. The planner, free move and conversion half is not built.**

Read that line before anything else in this file. CORE-2 as specified spans the Product
Profile → Audit contract *and* an AI Action Planner, a free first Move, preview, and the
upgrade gate. This sprint delivered the first half and stopped at an agreed checkpoint. What
is missing is listed in *Not built* below, honestly and by name.

## Goal

Make the Product Profile the canonical semantic understanding of a product, and make the
Business Audit reason **from** that understanding rather than re-deriving it from raw
scanner output.

CORE-1 ended with *"Vibe understands your product."* This half begins the answer to
*"…and here's what that means for your business."*

## Context

CORE-1 closed with an explicit open question, recorded in
[its own sprint doc](0021-core1-product-understanding.md#risks--notes):

> **Audit input preparation is documented, not wired.** The Business Audit still builds its
> own evidence pack v2 and is untouched. Where the profile belongs is: as a replacement for
> the founder-typed `business_context` prerequisite, or alongside it — that is a CORE-2
> decision with its own reuse-identity consequences.

This sprint answers it: **as a replacement.**

## Canonical Knowledge Model

```
Repository Intelligence ─┐
Live Product Intelligence├─→ PRODUCT PROFILE ─→ BUSINESS AUDIT ─→ NEXT MOVES ─→ EXECUTION
Deep Scan (optional)     ┤        ▲
User-confirmed facts ────┘        │
                          corrections, applied on read
```

Evidence tells Vibe what exists. The Product Profile tells Vibe what the product **is**. The
Business Audit tells the user what that **means**. Next Moves decide what happens next.

The scanners stay technically separate and stay citable — the audit's "Why?" disclosure
resolves cited ids back to concrete observations, so replacing scanner evidence with the
profile would have broken explainability. The profile is added *above* them, not instead of
them.

## Business Context Migration

### What existed

`project_business_context` — one row per project, five founder-typed fields, one of them
required. `product_summary` was a hard prerequisite for a first audit: a founder could not be
audited until they had typed a paragraph describing their own product.

### What it became

| Field | Where it went | Why |
|---|---|---|
| `productSummary` | Product Profile correction `shortDescription` | A statement about the product |
| `targetCustomer` | Product Profile correction `primaryAudience` | A statement about the product |
| `stage` | Founder Intent | Where the founder thinks they are |
| `monetizationModel` | Founder Intent | What the founder *intends* |
| `primaryGoal` | Founder Intent | What the founder is trying to do next |

The first two migrate into `product_profile_corrections`, which is a **stronger** home than
the table they came from: `applyCorrections` renders a correction as `confidence: "confirmed"`
with source `user_confirmed`, so it outranks every derived value and survives every re-scan.
That is exactly the semantics CORE-2 §5 asks for, and a second parallel table could never have
expressed it.

The SQL puts the migrated keys on the **left** of the `||` merge, so an existing correction
wins. A founder who has already corrected the profile directly said something newer and more
considered than the summary they typed into the old audit form.

### Why `monetizationModel` is intent and not profile

CORE-2 §4 names "pricing model" and "business model" among the concepts that must not be
duplicated, so this is the placement that needs defending.

It is not duplicated. The profile owns what is **observable** — whether a pricing surface
exists, whether payment or subscription capability is present — as `businessSignals` derived
from evidence. Founder Intent holds something evidence cannot see: a declared intention, whose
most useful value is `planned`, meaning precisely that nothing is observable yet.

An audit that cannot tell *"no monetization, and none intended"* from *"no monetization yet,
subscription planned"* would prioritize the same work for two very different businesses.

### What was removed

- `project_business_context` — table dropped, after both copies complete in the same migration
- `business-context-store.ts` — deleted
- `business-context-form.tsx`, `business-context-action.ts` — deleted
- `parseBusinessContext`, `hashBusinessContext` — deleted (the write path)

`src/modules/projects/business-context.ts` survives as a **frozen type-only record**, and only
because evidence packs `business-evidence.v1` and `.v2` are the contracts previously stored
audits were produced under. Their builders still describe what those packs contained, and
describing it requires the shape. Rewriting them would silently change what an old
`evidencePackVersion` means.

**No code path can write a business context.** That is the §4 requirement, and it is
structural rather than a convention.

## Audit Contract

`business-evidence.v3` replaces v2 as the pack the audit and the Opportunity Engine both
build. v1 and v2 are untouched.

The Product Profile is a **required** input, enforced where it cannot be routed around — in
`loadAuditSources`, which returns `product_profile_missing` and has no fallback. A fallback is
exactly how a second product-understanding pipeline would arrive (§8), so there is not one.

Both runners moved to v3 together. They had to: the Opportunity Engine rebuilds the audit's
pack so citations resolve against the same ids the audit saw, and leaving it on v2 would have
had opportunities validating against a different id set than the audit's.

### What the pack now opens with

v2 opened with `business.product_summary` — a paragraph typed before Vibe was allowed to look
at anything. v3 opens with `profile.identity.*`, `profile.audience.*`,
`profile.capability.*`, `profile.journey.*` and `profile.signal.*`, each carrying the
confidence and provenance CORE-1 established.

Provenance travels with the claim, and the ordering is enforced by the pack rather than
requested in the prompt. A `user_confirmed` line says **"stated by the founder"**; an inferred
one says "likely, inferred from several agreeing signals". A capability found only in code
stays `likely` and never reaches `confirmed`.

### Minimization

Forwarded: semantic fields, capability and journey labels from closed vocabularies, business
signal statements, and the technical facts that carry business meaning.

Not forwarded: brand assets, colours, typography, raw evidence id lists, repository file
paths. Brand belongs to execution (§29), not to diagnosis — a hex colour has never changed a
business conclusion. All four exclusions are asserted in `evidence-v3.test.ts`.

## Profile Versioning

An audit's input identity now includes `productProfileId`, `founderIntentHash`,
`profileSchemaVersion` and `profileBuilderVersion`.

The id alone would not have been enough. A profile carrying the same id means the same
derivation only while the derivation itself is unchanged, so recording the versions is what
makes CORE-2 §7 answerable later — *"audit #X used Product Profile v4"* — from the stored row
rather than from a guess about what the code did that week.

Corrections are deliberately **absent** from the identity, for the same reason they are absent
from the profile's own hash: they are applied on read, so editing a description must not
silently buy a new paid audit.

Stored on the audit row: `product_profile_id` (`on delete restrict`),
`product_profile_schema_version`, `product_profile_builder_version`, `founder_intent_hash`.

Pre-CORE-2 rows keep `product_profile_id` null. Back-filling one would be inventing a fact; a
stored audit must keep meaning what it meant when it was written. New rows are required to
carry one by a CHECK expressed against `evidence_pack_version = 'business-evidence.v3'`, so
the constraint stays true regardless of when the migration is applied.

## Free Audit

**The first qualified Business Audit is free**, gated server-side in `entitlement.ts` — a pure
decision function with no Supabase and no provider knowledge, deliberately mirroring the Deep
Scan's `authorizeDeepScan`.

### Consumption

```
a completed audit funded by the included entitlement  →  consumed
anything else                                          →  still available
```

Derived, never a flag. A provider outage, an internal timeout, a validation failure in Vibe's
own infrastructure, or our persistence failing all arrive as "no completed audit" and cost the
user nothing. There is no refund path because there is nothing to refund. The grant is written
*after* `completeAuditRun`, and the ordering is the policy.

A partial unique index on `(project_id) where status = 'completed' and access_mode =
'included_first_audit'` makes a second one impossible even under a race.

### Why that index is not sufficient on its own

Because a project is deletable. Disconnect and reconnect the same repository and the
project-scoped proof is gone with it — the "trivial reset" §16 forbids.

`free_audit_grants` is the durable half, keyed on the **GitHub repository id**, which is stable
across disconnect/reconnect. It deliberately holds no foreign key to `projects`, so a project
deletion cannot cascade it away. Scoped to `(user, repository)` rather than to the account:
a founder with three genuinely different products should get three first audits; what they
should not get is an unlimited supply of first audits for one product.

It has a `select` policy and **no insert, update or delete policy**. Consumption is recorded by
durable execution through the service-role client, so a user cannot clear, forge or replay
their own entitlement through the API at all. The absence of a policy is the enforcement.

### Retry

Every internal failure is retryable, because none of them consumed anything. The bound is
`AUDIT_START_LIMITS` (5 starts/hour/project), not the entitlement — the two are separate so an
outage is never mistaken for abuse, and `providerFailuresCountTowardLimit: false` encodes that.

## Human-First Audit

`human-view.ts` re-orders the stored audit. It is a view, not a second engine: every sentence
it produces is already in the audit.

```
What Vibe thinks about the business     ← conclusion, composed from strongest/weakest assessed
  What's already working                ← strengths, strongest dimension first
  What's holding you back               ← gaps, weakest dimension first (the ordering IS the priority)
  Why it matters                        ← key findings
  Where I'd start                       ← links to the Opportunity Engine
  [See the full breakdown by dimension] ← collapsed
  What Vibe couldn't see                ← unassessed dimensions + limitations
```

The score is still on the page and still true — CORE-2 §14 makes it *secondary*, not absent,
and hiding a number the product computed would be its own kind of dishonesty.

**"Where I'd start" computes nothing.** §18 requires next moves to come from the existing
Opportunity Engine, so the section links to them. A `nextMoves` field on this view would be the
second recommendation engine §18 forbids, and a unit test asserts the key is absent.

The load-bearing rule is CLAUDE.md rule 44: an unassessed dimension has no score, so a naive
sort would place it **first** and a founder would read *"Vibe could not tell whether people
come back"* as the single biggest thing holding their business back. `blockersFrom` filters
unassessed dimensions out entirely, and a browser test proves they are not under that heading
on screen.

## Usage

Unchanged in mechanism, extended in dimension. `business_audit.started` and
`business_audit.completed` now carry `accessMode` and `productProfileId`, which is what makes
the activation funnel answerable from the existing audit log without a second analytics
platform (§52). AI usage recording is untouched — still one paid call, still recorded for
successes and failures alike.

## Validation

| | |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | 3000 passed / 157 files (was 2935 / 154) |
| `pnpm build` | production build green |
| `pnpm test:e2e` | 106 passed, chromium (was 89) |

New unit coverage: founder intent parsing and hashing (28), free audit entitlement (20),
evidence pack v3 (28), human-first view (14).

New browser coverage (`e2e/business-audit.spec.ts`, 17 tests) at 1440 / 1024 / 768 / 375:
reading order measured by bounding box, the breakdown collapsed on first paint, an unassessed
dimension absent from "what's holding you back" and present under "what Vibe couldn't see",
coverage stated in words, no score and no zero when nothing could be assessed, the moves link,
heading nesting, keyboard-operable disclosures, and zero horizontal overflow at every width.

### What the browser suite found

Three defects a unit test could not:

1. **The reading order lived in the route, not the component.** `AuditConclusion` rendered the
   conclusion and the route appended the breakdown disclosure, so "tech last" was a property of
   `score/page.tsx` that no test touched. The component now owns all three layers; a route can
   no longer reorder them silently.
2. **Two sections were indistinguishable to a scoped query**, because the collapsed breakdown
   legitimately names every dimension. Without `data-testid`, the rule-44 assertion was finding
   the unassessed dimension in the *breakdown* and would have passed even if it had also been
   in the blockers list.
3. **`Well` silently drops unknown props**, so a test hook placed on it vanished.

## Dogfood

**Performed for the audit leg, against the real product. It found four defects, one of which
cost a billed model call.**

The remaining legs — Move, preparation, preview, merge — are the half that is not built.

### 1. The entitlement gate was never called (cost real money)

`authorizeAudit` existed as a tested pure function and **nothing on the write path invoked
it**. `startAuditAction` called `startBusinessAuditOperation`, which checked prerequisites and
reuse and then went straight to claiming a run.

So pressing "Re-run business audit" on a project whose free audit was already consumed:

1. started an operation,
2. counted tokens, called the model, and was billed,
3. then failed at stage `persisting` — because `completeAuditRun` set `status = 'completed'`
   and collided with `business_readiness_audits_one_included_idx`.

Operation `dac026a9-…`, `audit_failed`, `inference_started_at` set. The user saw
*"Business audit couldn't complete."* and nothing else.

Two things were wrong, and both are fixed:

- **The gate is now enforced in `startBusinessAuditOperation`**, not in the Server Action, so
  it covers every caller rather than the one that remembers. It sits *after* reuse resolution
  — returning a stored audit costs nothing and must keep working once the entitlement is
  spent — and *before* anything is claimed.
- **The unique index now covers in-flight rows too**
  (`20260816140000_included_audit_claim_guard.sql`). That moves the collision from *after*
  inference to the INSERT that claims the run, so even a caller that skips the gate fails
  before a single token is counted. Failed rows stay excluded, because a failed audit consumed
  nothing and must not block its own retry.

The regression test asserts the property that matters — not "it refuses", but that it refuses
with **no operation row, no audit row, and the executor never started**.

### 2. The conclusion sentence was not a sentence

The screen read:

> Where you're strongest: do people understand what you built? Where you're weakest: can you
> make money from it?

`DIMENSION_QUESTIONS` are questions, and interpolating them into a sentence produces question
marks mid-clause. In the one sentence CORE-2 §14 makes a founder read first.

**Every test was green, because the unit test asserted that exact broken string.** A test that
pins the output rather than the property will happily enforce a defect. `DIMENSION_TOPICS` now
holds the same five dimensions as noun phrases, and the tests assert the property instead: no
`?`, ends in a full stop.

### 3. Evidence ids leaked into the prose

> Authenticated area reached with Dashboard, Integrations, and Project workspace surfaces
> present (auth.area.reached, auth.surface.dashboard, auth.surface.integrations,
> auth.surface.project_workspace)

Model output citing its own ids inline, printed in "What's already working" — machine
identifiers in the first thing a person reads, with the *same* ids already resolved into
plain language by the "Why?" disclosure directly underneath.

`withoutInlineEvidenceIds` strips a trailing parenthetical whose contents are entirely dotted
identifiers, and nothing else: a parenthetical containing a real clause is the model saying
something rather than citing, and removing it would delete content.

### 4. The button contradicted the notice

"Re-run business audit" rendered prominent and enabled directly above *"You've used the free
audit for this project."* Pressing it is what triggered defect 1. All three start paths — the
main button, "Start a new audit" after a stall, and "Try again" after a failure — now respect
the same gate the server does.

Also fixed: `audit_failed` read *"The business audit could not be completed."* under a heading
already saying *"Business audit couldn't complete."*

### What the dogfood did not cover

The v3 pack itself. Every audit on the live project predates it, so what was exercised is the
new screen rendering **old v2 audits** — which it does correctly, including the traceability
columns being null on pre-CORE-2 rows. Whether v3 produces a *better* audit is still unproven,
and needs a project whose free audit has not been spent.

CORE-2 §57–§58 asks for the complete flow — Profile → Audit → Moves → First Move → Preview →
Merge — to be run against Vibe Business itself. Most of that flow is the half that is not
built. The audit leg was run; see below.

What *was* verified end to end: 3000 unit tests, 106 browser tests, a green production build.
What was **not** verified: that the v3 pack produces a better audit than v2 did against real
evidence, and that a founder reads the new conclusion and recognises their business. Both are
judgements that need a real run, and neither is claimed here.

## Migrations

`supabase/migrations/20260816020000_founder_intent_and_audit_traceability.sql`

**Applied to the linked project (`dcbwlctscooefwnivxzv`), verified by reading the database
back rather than by trusting the CLI's own report.**

The ref was checked against `NEXT_PUBLIC_SUPABASE_URL` and `config.toml` before anything ran,
per CLAUDE.md rules 32–33 — never guess a ref, and never the unrelated `Planner-Agent` project.

### The defect inspecting first caught

Rule 30 says inspect migration history and live state before pushing, and it paid for itself
here. The live database had **20 audits, ten of them completed for a single project** — run
while the audit was ungated and freely repeatable.

`access_mode` was originally declared `not null default 'included_first_audit'`. That default
would have written the value onto all ten, and then:

```sql
create unique index business_readiness_audits_one_included_idx
  on public.business_readiness_audits (project_id)
  where status = 'completed' and access_mode = 'included_first_audit';
```

...would have failed on creation with a unique violation, **aborting the migration partway**.

The fix is not a weaker index. It is that neither existing enum value is *true* of those rows:
they consumed no one-per-project entitlement, because none existed, and they spent no credits.
Writing either would have put a false statement into the column whose entire purpose is to
prevent that.

So `legacy_pre_entitlement` was added — the honest description of a row written before the rule
it would otherwise claim to have followed. Nothing writes it going forward. The earliest
completed audit per project becomes `included_first_audit`, which is accurate: those projects
have already had a free audit. And the `DEFAULT` is gone entirely, because a default is
precisely how ten rows quietly acquired an entitlement claim.

`free_audit_grants` is backfilled from those rows too. Without it the two halves would
disagree for existing data — the audit rows saying the free audit was consumed, the grant table
saying nothing — and the first disconnect/reconnect would have handed those projects a fresh
free audit, the exact reset §16 exists to prevent.

### Verified after applying

| | |
|---|---|
| Migration in remote history | `20260816020000` local = remote |
| `project_business_context` | dropped |
| `project_founder_intent` | 2 rows, RLS on, 4 policies |
| `product_profile_corrections` | 2 rows, each with `shortDescription` + `primaryAudience` |
| `free_audit_grants` | 2 rows, RLS on, **1 policy (select only)** |
| `access_mode` | 2 `included_first_audit`, 18 `legacy_pre_entitlement`, 0 null |
| Both unique indexes | present |
| Security advisors | no findings against either new table |

Dry-run predictions before the push (2 included / 18 legacy / 2 grants) matched the result
exactly.

What it does, in order — step 2 runs *before* step 1 drops anything:

1. `project_founder_intent` created, RLS on, four policies
2. intent rows copied; product fields merged into `product_profile_corrections`
3. `project_business_context` dropped
4. audit traceability columns + the v3 CHECK
5. `access_mode`, backfilled and then constrained, + the one-included-audit partial unique index
6. `free_audit_grants` + select-only RLS, backfilled from the included audits

`intent_hash` is back-filled with a padded literal rather than a computed digest. The real hash
is a sha256 over a fixed-order JSON array built in TypeScript, and Postgres' own JSON text
output spaces its separators differently — any SQL reconstruction would produce a *plausible
but wrong* digest, which is worse than an obviously placeholder one. The literal contains
non-hex characters so it cannot collide with a real hash. Its only effect is that the first
audit after the migration does not reuse an audit produced before it, which is correct anyway:
the audit contract changed.

## Not built

Deliberately, at an agreed checkpoint. None of this is started, and no scaffolding for it
exists:

- AI Action Planner and the Action Spec (§26–§29)
- Execution suitability distinct from audit priority (§21, §25)
- Free first Move entitlement and orchestration (§22–§24)
- Before/after preview and the change explanation (§36–§39)
- Post-success conversion and the upgrade gate (§43–§45)
- The remaining funnel events (`move_selected`, `free_move_started`, `action_plan_created`,
  `execution_completed`, `preview_viewed`, `upgrade_gate_reached`)
- The high-value activation E2E (§68)
- The dogfood (§57)

### The constraint the second half has to resolve first

CORE-2 §22/§30 wants the free first Move to include AI-written landing copy, CTAs and pricing
presentation. Two things stand in the way, and neither is a detail:

- **CLAUDE.md rule 57 and [ADR 0014](../decisions/0014-first-execution-safety.md) §4** forbid
  model output from becoming generated code. ADR 0014 §6 defers AI code generation explicitly,
  so that it can be introduced without simultaneously proving the write path.
- **The Execution Engine has exactly one capability** — `nextjs_seo_foundations_v2`, a
  deterministic generator writing `robots.txt` and `sitemap.ts`. Nothing in it can write copy.

So an Action Planner can be built now and routed to deterministic capabilities without touching
either constraint — that is the agreed direction — but the free Move it enables will only cover
what a deterministic capability can produce. Model-authored file *content* requires a
superseding ADR, and sandbox validation ([ADR 0015](../decisions/0015-untrusted-repository-execution-provider.md))
already exists to make it checkable when that decision is made.

## Next Recommended Phase

**CORE-2b** — Action Planner → execution suitability → free first Move → preview → upgrade
gate, followed by the dogfood that closes both halves.

Then **CORE-3** — Pro Subscription + Vibe Credits + Usage Economics, which needs the real usage
data CORE-2b produces.

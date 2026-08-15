# Sprint 13A — Execution Capability Expansion

**Status: PARTIAL.** The architectural prerequisite is done and verified. **None
of the three capabilities are built.**

| Slice | State |
| --- | --- |
| Pre-flight inventory + real applicability check | ✅ Done — findings below |
| Capability registry with a completeness contract | ✅ Done, 18 tests |
| Write budgets (§44) | ✅ Done |
| Promissory-claims guard for rationale copy | ✅ Done — found by a deliberate regression |
| `nextjs_metadata_foundations_v1` — detector + generator | ✅ Done, 36 tests |
| `nextjs_metadata_foundations_v1` — registry wiring, outcome profile, UI, dogfood | ⛔ Not built |
| `nextjs_primary_cta_v1` | ⛔ Not built |
| `nextjs_pricing_foundation_v1` | ⛔ Not built |
| Readiness states, input contract, review targets, UI, E2E | ⛔ Not built |

## Why this stopped where it did

§13 says to identify and centralise duplicated capability logic **before**
adding three capabilities. That inventory found the problem is real and larger
than it looks, so it was fixed first — and the sprint's remaining scope is
several times the size of any single sprint delivered so far.

Rather than start three capabilities and finish none, this delivers the
prerequisite completely, plus the pre-flight findings that change what should be
built first.

## The §13 finding: capability knowledge is spread across eight modules

Every one keyed by the same union, with nothing forcing agreement:

```
execution/schema.ts              the union + version map
execution/paths.ts               write allowlist
execution/outcome-contract.ts    product outcome profile
execution/measurement-contract.ts measurement profile
execution/business-rationale.ts  rationale
execution/generators/            generator
execution/view.ts                display
outcome-verification/schema.ts   verification profiles
```

Survivable with one capability. With four it is a trap, and the failure is
silent in the worst way: a capability could ship with a generator and **no
rationale**, or with an outcome profile that verifies files its generator never
writes. Both execute successfully and then explain themselves wrongly.

## What was built

### The registry — an index, not a framework

`capability-registry.ts` does **not** move the existing modules or wrap them.
Each still owns its logic, which is where that logic belongs. What it adds is
one place that can answer *"is this capability complete?"* and a test that fails
when the answer is no.

It also has no copy of the version, the allowlist, the rationale or the
profiles — it reads each from the module that owns it, so it cannot drift from
them.

Completeness requires a rationale, a product outcome profile, a write
allowlist, a budget and a version. A **measurement profile is deliberately not
required**: business measurement is optional evidence that may never arrive, and
requiring it would make executability depend on analytics — exactly the coupling
the 12C cleanup removed.

### Write budgets (§44)

`paths.ts` already answered *which* files a capability may write. It did not
answer *how many*. A deterministic generator emitting nine files is a defect
whatever their names, and a diff that size stops being reviewable — which is the
property the human-approval gate rests on.

The number lives in the registry, not in the generator that would be exceeding
it, and a test pins each budget to the length of its write allowlist so the two
descriptions of scope cannot disagree.

### The promissory-claims guard — found by a regression, not by reasoning

Mutation 3 introduced *"This increases organic traffic to the product"* into a
rationale. **All tests passed.**

`CAUSAL_PHRASES` was written for measurement copy, which fails
**retrospectively** — "this change increased signups" claims causation for
something merely observed. Rationale copy fails **prospectively** — it promises
an outcome, before anything has happened at all. The existing guard had no
coverage for that, and §2 forbids exactly those claims.

`findPromissoryClaims` closes it: growth verbs aimed at business nouns,
guarantees, and predictions — as patterns rather than a phrase list, because
*"improves how the product can be described"* is a factual statement about a
capability and *"improves conversion"* is a promise. It reuses the same
negation window, which is what lets a rationale say *"does not guarantee
rankings, traffic or revenue"* without tripping the guard that sentence exists
to satisfy.

## Deliberate regressions — 6 applied, 6 killed

| # | Regression | Result |
| --- | --- | --- |
| 1 | Capability ships with no rationale | ✅ fails |
| 2 | Rationale limitation emptied | ✅ fails |
| 3 | Causal/promissory claim introduced | ❌ **survived** → guard added, then ✅ |
| 4 | Write budget bypassed | ✅ fails |
| 5 | Budget decoupled from the write allowlist | ✅ fails |
| 6 | Limitation weakened into a promise | ✅ fails |

Mutation 3 is the one worth remembering: the guard everyone assumed covered
rationale copy did not, and only a deliberate regression showed it.

## Pre-flight: what the three capabilities would actually find here

Resolved against the real repository and the live homepage, before any detector
was written. §70 asks for truth over three green demos, and the truth is that
**two of the three would not execute on this codebase**:

| Capability | Real state | Honest readiness |
| --- | --- | --- |
| Metadata | `layout.tsx` has `title` and `description`; **no Open Graph** | Partially applicable — could add the missing OG fields only (§10, §60) |
| CTA | Homepage already has `<Link href="/login">Get started</Link>` using the design system's `buttonClassName` | **`not_applicable`** — a CTA exists and must not be duplicated (§72) |
| Pricing | No pricing route; the offer is not defined anywhere in business context | **`needs_user_input`** — and Vibe must never choose a price (§26, §73) |

This is the §75 picture, and it argues for building **metadata first**: it is
the only one with a genuine executable gap here, its write scope is smallest,
and it is the one that could be dogfooded end to end.

It also means the CTA capability cannot be dogfooded on this repository at all
without inventing a problem — which §72 explicitly forbids.

## What was NOT built

The three capabilities and everything specific to them: detectors, generators,
readiness states beyond what exists, the capability input contract, the review
target model (§48 — the genuinely hard design question about new-route
before/after semantics), the opportunity mapping, the input UI, browser E2E for
the new flows, and the dogfood.

## 13A.1 — Metadata capability (detector + generator)

### Current state, re-resolved

Checked against **both** the repository and the live homepage before writing
anything, as §8 requires rather than trusting the earlier finding:

```
src/app/layout.tsx   title ✓   description ✓   openGraph ✗
live homepage        <title> ✓  <meta name="description"> ✓   og:* ✗
```

The gap is real and unchanged. State D of §3 → **applicable**.

### Detection — built on the Sprint 8 lesson

Sprint 8 reported `robots.txt` as present because a *parser* contained the
string. Metadata is the same trap with more surface: `openGraph`, `title` and
`description` appear in type definitions, fixtures, docs, helpers and dead code,
and none of those put a tag on a page.

The rule is therefore structural rather than textual: the detector's only input
is the **resolved framework-served metadata source**. A parser or a fixture
cannot reach it, because there is no parameter it could arrive through.

| Situation | Readiness |
| --- | --- |
| `title` + `description`, no Open Graph | `ready` |
| Owned Open Graph fields already present | `not_applicable` |
| No metadata export at all | `unsupported` — creating one is a structural edit, not a gap fill |
| `generateMetadata()` factory | `unsupported` — editing it blind could override values computed per request |
| No truthful title or description anywhere | `needs_user_input` |

### Trusted content precedence

`existing metadata → business context`, and **existing always wins**. A title
already served by the framework is the customer's decision; rewriting it to
something Vibe prefers would edit their product's voice under the guise of a
fix. `og:url` and `siteName` are omitted entirely when unknown — an empty
`og:url` is worse than none because it looks like an answer.

No AI anywhere in the path, and no fallback copy: if nothing truthful exists,
the answer is `needs_user_input`.

### Generator — an edit, not a creation

The SEO generator writes two new files. This one changes a file the customer
owns, so the failure mode is not "an unwanted file appears" but "their layout is
rewritten". The edit is therefore the narrowest that can work: the existing
`metadata` export gains an `openGraph` block, the file's own indentation is
matched, and nothing else is touched.

Values are serialized with `JSON.stringify`, not interpolated. A product title
is customer text and the output is **code** — a title containing a quote, a
backtick or `"; process.exit()` must become a valid string literal. Nine hostile
inputs are tested by round-tripping the emitted literal back through
`JSON.parse`, which proves the value cannot leave its quotes rather than merely
checking that suspicious substrings are absent.

The generator refuses rather than guessing when the export is not the expected
shape, and refuses to add a second `openGraph` key — two would be a
syntax-valid file whose later key silently wins.

### Deliberate regressions — 5 applied, 5 killed

| # | Regression | Result |
| --- | --- | --- |
| 1 | Complete metadata becomes `ready` | ✅ fails |
| 2 | Custom `generateMetadata()` factory edited anyway | ✅ fails |
| 3 | Missing trusted copy invented instead of asking | ✅ fails |
| 4 | Existing Open Graph overwritten instead of preserved | ✅ fails |
| 5 | Hostile input interpolated instead of serialized | ✅ fails — **7 tests** |

Regression 5 first appeared to survive. It had not applied: the substitution's
escaping was wrong, so the file was unchanged and the run was measuring nothing.
Applied properly it kills seven tests. A mutation that does not modify the file
is not evidence of anything, and the check for that is cheap.

### The wiring analysis — why "just register it" is not small

Verified against the code, not estimated. Four concrete mismatches, each of
which exists because **every capability so far has created files that did not
exist, and metadata is the first that edits one the customer owns.**

**1. The preflight actively blocks editing capabilities.**
`runExecutionPreflight` contains:

```
if (probe.existingTargetPaths.length > 0) → blocked (conflicting_files_exist)
```

For SEO that rule is exactly right — never overwrite a `robots.ts` somebody
wrote. For metadata it is inverted: the target file **must** exist, because the
capability extends it. As written, an editing capability can never pass
preflight. This is the sharpest of the four and needs the rule to become
capability-aware rather than global.

**2. The preflight probe is SEO-shaped.** It carries `liveRobotsServed` and
`liveSitemapServed` — specific public checks for one capability's premise.
Metadata's premise is "the framework-served export lacks `openGraph`", which
that shape cannot express.

**3. `paths.ts` models creation.** Its allowlist is *"exact basenames a
capability may create"*. An editing capability needs an allowlist of paths it may
**modify**, which is a different permission with a different risk profile.

**4. The preparation probe cannot read file contents.** `ExecutionProbe` exposes
`getHead`, `findExistingPaths`, `isServed` and `hasWritePermission`. The
metadata generator needs the current source of `layout.tsx` to extend it. The
underlying `git-port` *does* have `getFileContent`, so this is plumbing rather
than new capability — but it is not currently reachable from preparation.

Also required, and smaller: capability dispatch in
`resolveExecutionCapability` (currently hard-coded to robots+sitemap absence
evidence), and extending `computeExecutionIdentity` to include the trusted
metadata values so a changed title cannot reuse an old PreparedChange identity
(§8).

None of this is difficult. All of it is in the repository-write path, which is
the most consequential code in the product and the wrong place to work
quickly.

### Not yet built in this slice

Registry wiring for the new capability id, the `nextjs_metadata_outcome_v1`
product-outcome profile, opportunity resolution, the user-facing UI, browser
E2E, and the real dogfood. The detector and generator are the parts where a
silent mistake is unrecoverable; the remainder is wiring onto contracts that
already exist.

## Suggested split

1. **13A.1** — metadata capability end to end on the registry, including its
   outcome profile and a real dogfood. Smallest scope, only genuinely executable
   gap here.
2. **13A.2** — the `needs_user_input` readiness state and the capability input
   contract, dogfooded through pricing up to the point a real business decision
   is required. No price is ever chosen by Vibe.
3. **13A.3** — the review target model (§47/§48) and the CTA capability, which
   needs it because a new route has no honest same-page "before".

## Quality gate

`pnpm lint` · `pnpm typecheck` · `pnpm test` (2612 tests, 133 files) ·
`pnpm build` · `pnpm test:e2e` (58 chromium) · `pnpm db:status` (23/23, nothing
pending) · `pnpm db:lint` — all green. **No migration**: nothing here needs
persistence.

Zero AI, sandbox, browser, GitHub-write and analytics calls.

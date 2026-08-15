# ADR 0020 — Production outcome verification

**Status:** Accepted
**Date:** 2026-08-14
**Sprint:** [12A — Production Outcome Verification](../sprints/0012a-production-outcome-verification.md)

## Context

Sprint 11C closed Vibe's first complete change lifecycle. A default branch moved to a commit a human approved, by fast-forward, verified by an independent read-back.

Every gate up to that point answers a question about **Vibe's own work**:

```
repository_write_verified   the bytes on the branch are the bytes we meant
sandbox_validation_passed   those bytes install, typecheck, test and build
preview_available           that exact artifact ran and was reachable
review_artifact_available   a controlled before/after comparison exists
human_approved              a person looked at one commit and said yes
merged                      the default branch moved
```

Not one of them is a statement about the customer's product. `merged` says bytes are on a branch; it does not say a visitor to the website sees anything different. And the gap between those two sentences is where a product that automates changes either earns trust or quietly loses it.

The next gate is **measure**. But "measure" is at least two questions, and they are not the same size:

- *Did the intended observable product behaviour appear publicly?*
- *Did traffic, conversion, activation, retention or revenue improve?*

The second needs analytics integration, attribution, a baseline, and an argument about causality. The first is, for a deterministic capability, a small number of HTTP requests with an unambiguous answer.

This ADR is about the first only.

## Decision

### 1. Three levels, never collapsed

```
DELIVERY          repository state changed as intended        Sprint 11C
PRODUCT OUTCOME   intended public behaviour appeared          this sprint
BUSINESS OUTCOME  traffic / conversion / revenue moved        not built
```

They are separate fields on the server-decided card and separate rows on screen, so no component can render one without the others. `businessImpactMeasured` is a constant `false` the UI is required to display.

A verified product outcome is **not** evidence of business impact, and the product says so on every success surface.

### 2. Public observation is not deployment provenance

Vibe controls no deployment provider and reads no deployment API. Observing `/robots.txt` and `/sitemap.xml` behaving as the merged capability intended is *consistent with* the new build serving — it is not proof, and it carries no provenance for which commit is live.

So the vocabulary is `verified` / `partial` / `not_observed`, and never `deployed`, `live`, `released` or `shipped`. `deploymentVerified` stays a constant `false` on the card, exactly as it is on the merge card.

The inverse claim is refused too: `not_observed` never renders as "deployment failed", because Vibe has no evidence either way.

### 3. The outcome contract belongs to the execution capability

The rejected design is a measurement service containing `if (capability === "seo") fetch("/robots.txt")`. It becomes a switch statement that knows the intimate details of every generator and is updated by nobody when a generator changes.

Instead, the capability that knows what it wrote says what it expects to see. `src/modules/execution/outcome-contract.ts` derives the expectations from **the generator's own classification functions** — `selectSitemapRoutes` and `excludedSurfacePrefixes` — not from a second opinion about what it probably emitted. A test generates the real files and asserts the contract agrees with their contents, so a change to route selection that is not reflected in the contract breaks the build.

### 4. Deterministic verification, before any AI

No model invents success criteria after a merge. A model asked to mark its own homework would produce criteria that always seem to be met, and they would drift with every prompt revision.

An unsupported capability is `outcome_not_supported`. There is deliberately no AI fallback.

### 5. The expectation is frozen before observation

Persisted as JSONB on the row at creation, versioned by `outcome-evidence-v1`, and never rewritten. Production changing afterwards must not change what Vibe said it was looking for, or a historical verification stops being historical.

### 6. Versioned outcome semantics

`outcome-policy-v1` fixes the rules of observation: the window, the schedule, the safe-HTTP boundary, how a missing endpoint is classified, and what may be persisted as evidence. `nextjs_seo_foundations_outcome_v1` fixes the expectations themselves.

Both are part of the verification's identity, so changing what "verified" means later cannot reinterpret rows that were checked under different rules.

### 7. Observation reuses the safe outbound HTTP boundary

Every request goes through `safeFetch` (ADR 0010, CLAUDE.md rule 35), unchanged: scheme and credential policy, DNS resolution with every returned address gated, connection pinned to the address that passed, per-hop redirect revalidation, streaming byte and timeout budgets, content-type refusal before parsing.

**This is not a crawl.** Two absolute paths on one origin, taken from the contract. No link is followed, no sitemap entry is fetched, no sitemap index is walked, no authenticated route is touched, no browser is opened, no JavaScript is executed.

The origin is resolved server-side from the project's production URL and re-validated through the same policy that refuses HTTP, credentials, internal names and unsafe literals. The client has no parameter in which to name a URL.

### 8. A bounded observation window, with read-only retries allowed

Production may not update instantly, or ever. Treating the first missing endpoint as final would report "not observed" for a product mid-build.

So: fifteen minutes, seven attempts at fixed offsets `[0, 30s, 60s, 2m, 4m, 8m, 15m]`, exiting the moment every expectation holds. Worst case fourteen public GETs.

The deadline is written to the database once and read back on every attempt. It is never recomputed from `now()` — a replayed workflow that recalculated its own window would extend it on every re-entry.

**Retries are permitted here, and this is the deliberate opposite of the merge.** `writeDefaultRef` is `maxRetries = 0` because a retried write can move somebody's branch twice. A retried `GET /robots.txt` observes the same public file again. What retries must not do is blur the vocabularies: a transport error is a fact about Vibe's observation, never evidence the product misbehaves.

### 9. Four terminal states, because three of them are different sentences

```
verified       every expected behaviour was observed
partial        some held and some did not, by the deadline
not_observed   none of it appeared — production may simply not have updated
failed         Vibe could not observe reliably
```

`not_observed` is about the product. `failed` is about Vibe. Sharing a code path between them is how they eventually become one sentence, so they have separate store functions and separate audit events.

Per-check truth is preserved and never hidden: a card showing only its green lines turns a partial into a verified by omission.

### 10. The user requests; durable execution answers

A person clicks *Check production outcome*. Nothing starts automatically after a merge — this is a new product operation and its semantics should be observable before it is automated.

But the authoritative result is written only by the durable workflow under the service-role client. `change_outcome_verifications` has **no update policy and no delete policy**, so `verified`, the passed checks and the observation timestamps are unreachable from a browser session by construction rather than by convention.

No confirmation dialog: the operation is read-only against the customer's own public website and has no side effect to warn about. Copying the merge's ceremony here would teach users to click through dialogs, which is how the one that matters stops being read.

### 11. No raw content is ever persisted

Bounded derived evidence only — statuses, counts, booleans, a normalized content-type token, byte counts, redirect counts, typed transport failures. Never a response body, HTML, XML, robots text, sitemap contents, headers, cookies, or a query string.

Bodies are parsed inside the observation module and discarded, so nothing above it can persist one even by accident.

### 12. No automatic paid refresh

Outcome verification triggers no repository intelligence, no business audit, no opportunity generation, no deep scan, no browser session, no sandbox, and no AI call. A `not_observed` result offers no remerge, revalidate, rebuild or redeploy. Blocked work explains what happened; the user decides (CLAUDE.md rule 60).

Cost: `0` AI calls, `0` sandbox calls, `0` browser calls, `0` GitHub requests — read or write. Only bounded public HTTP.

## Consequences

**Good**

- The product can finally say something about the customer's product, not only about its own pipeline — and say it honestly.
- The failure mode the Sprint 9 dogfood surfaced (`/login` and `/signup` advertised in a sitemap) is now detectable *in production*, not only at generation time.
- The distinction between delivery, product outcome and business impact is now a data structure rather than a convention.

**Costs and limits**

- **Only one capability has a verifier.** Everything else is `outcome_not_supported`, honestly.
- **No re-check.** A terminal `not_observed` or `partial` is an answer; asking again until it comes back greener would be measurement theatre. A deliberate re-check is a future capability, not a hidden button.
- **Fifteen minutes may be too short for slow pipelines**, and there is no way to extend it. That is a deliberate bound, not an oversight.
- **A `partial` cannot distinguish "the deployment is half done" from "the change is wrong."** Both produce mixed checks. The per-check truth is shown; the interpretation is the user's.
- **No provenance.** Vibe cannot say the observed behaviour came from the merged commit rather than from something a human did in parallel.

## Alternatives considered

**Ask a model whether the outcome looks right.** Rejected. Post-hoc criteria are unfalsifiable, drift with prompt revisions, and cost money for an answer a `GET` already gives exactly.

**Poll a deployment provider.** Rejected for this sprint. It would give real provenance, and it is the honest way to ever say "deployed" — but it is a new integration, a new credential surface and a new ADR, and it is not needed to answer the question this sprint asks.

**Use the existing Live Product Intelligence crawl.** Rejected. It is a twelve-page crawl with a snapshot, a freshness window and an analyzer version, built to answer "what is this product like". Outcome verification asks a much narrower question about two files, and running a crawl to answer it would spend twelve page fetches, produce a snapshot nobody asked for, and entangle two very different retention policies. The *safety layer* is shared; the crawl is not.

**Keep observing until the outcome appears.** Rejected. An unbounded poll against somebody's production website is not diligence.

**Treat a missing endpoint as immediate failure.** Rejected. It reports "not observed" for a product that is mid-build, and it is the kind of wrong a user cannot argue with.

## References

- [ADR 0010 — Safe outbound HTTP inspection](0010-safe-outbound-http-inspection.md)
- [ADR 0013 — Durable operation execution](0013-durable-operation-execution.md)
- [ADR 0014 — First execution safety](0014-first-execution-safety.md)
- [ADR 0018 — Human approval authority](0018-human-approval-authority.md)
- [ADR 0019 — Safe approved change merge](0019-safe-approved-change-merge.md)

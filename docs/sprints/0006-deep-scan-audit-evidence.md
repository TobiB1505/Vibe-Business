# Sprint 6 — Deep Scan evidence in the Business Audit

Status: Complete. No migration required. Merged as [#17](https://github.com/TobiB1505/Vibe-Business/pull/17); the updated real audit was run once, by hand, after approval — see [Updated audit](#updated-audit-run-once-after-approval).
Branch: `feat/deep-scan-audit-evidence`

## Goal

Sprint 5 built the Deep Scan: a human-in-the-loop browser session that produces an `AuthenticatedProductIntelligenceSnapshot` describing the structure of a product's signed-in application. Nothing consumed it. This sprint feeds it into the Business Readiness Audit as **optional** evidence.

## Evidence architecture

```
RepositoryIntelligenceSnapshot ──────┐
LiveProductIntelligenceSnapshot ─────┤
BusinessContext ─────────────────────┼→ EvidencePack (business-evidence.v2) → one model call
AuthenticatedProductIntelligence ────┘   (optional — omitted when no Deep Scan exists)
  (latest successful snapshot only)
```

`business-evidence.v1` is **not modified**. It is the contract every stored audit was produced under, and rewriting it would silently change what an old `evidencePackVersion` means. v2 composes the v1 section builders unchanged and adds one category, `authenticated_product`.

A Business Audit still runs with no Deep Scan. The difference is an explicit absent-evidence note — *"nothing behind the product's login has been inspected"* — rather than a silent gap.

## The second data-minimization boundary

The analyzer already sanitizes what it stores. The Evidence Pack does not treat that as sufficient, because an authenticated application is the one evidence source whose page content is **other people's data**.

The first real Deep Scan proves the point. It recorded, entirely legitimately:

| Field | Value | Why it cannot reach a prompt |
| --- | --- | --- |
| `mainHeading` | a user's project name | Identifies a customer record |
| `path` | `/app/projects/<uuid>` | A record identifier |
| `actionLabels` | button captions | Can carry emails, amounts, ids |

So the boundary in `evidence-v2.ts` forwards **structure only**:

- headings are dropped wholesale — they are the field most likely to name a record, and nothing in the audit needs them;
- paths are generalized (`/app/projects/:id`) before they are emitted;
- action labels are filtered (no emails, URLs, query strings, UUIDs, long digit runs, monetary values), length-capped at 40 characters, count-capped at 12, and transient states like `Analyzing…` are dropped;
- surfaces come from a closed vocabulary, and everything else is a boolean or a count.

Verified against the real production snapshot: no heading, project name, record UUID, session id, or query string appears anywhere in the rendered pack.

## Presence is not function

A control labelled "Run business audit" is evidence that the control exists — not that the feature works. Each action emits as `auth.action.<slug>` with the label *"present in the signed-in product (presence only — not verified as functional)"*, and the prompt repeats the rule: never describe a feature as working, complete, or verified because a label was seen.

Symmetrically, an unobserved surface says *"not observed in the 6 page(s) inspected"*, never "absent". A Deep Scan inspects a handful of pages under a tight budget, and "we did not see billing" is not "there is no billing".

`applicationSignals` is a projection of the same surface detection, so it is deliberately **not** emitted a second time — a fact stated twice reads as corroborated by two sources when it has only one.

## Audit input identity

`computeAuditInputHash` now includes `authenticatedSnapshotId: string | null`, carried through as JSON `null` rather than a sentinel string so "no Deep Scan" can never be forged by an id.

Consequences: a first Deep Scan invalidates reuse and buys a fresh audit; a *second* Deep Scan does too (the id changes, not merely its presence); nothing else changes reuse behaviour.

**No migration.** The existing `input_hash` column already carries the whole identity, so nothing about the storage proved structurally insufficient.

## Prompt and rubric

- `PROMPT_VERSION` → `business-audit-prompt-v2`. The prompt previously stated the pack came from exactly three sources, which would now be false; it also gains the presence-is-not-function rule and the not-observed rule.
- `RUBRIC_VERSION` unchanged. The rubric already reasoned about authenticated app areas correctly, and adding "a Deep Scan means a higher score" would be gaming the metric rather than measuring it.

Nothing in the code raises a score because a Deep Scan exists. Scoring is deterministic and reads only the model's dimension assessments; a regression test runs the same verdict with and without authenticated evidence and asserts the overall score is identical.

## Deep Scan route priority

One refinement inside the existing analyzer, no broadening of crawling:

- a path the public crawl watched redirect to a login page is **proven** protected → `+15`;
- a link found in the signed-in UI → `+5`;
- a repository route the public crawl already rendered anonymously → `−8`.

The last is a **demotion, never a removal**. A signed-in `/` is frequently a different page entirely, so removing public-overlap routes would throw away real evidence. Priorities floor at 1, and the landing page is never adjusted.

## Audit UX

- **No Deep Scan, but authenticated surfaces detected** → *"Vibe has not analyzed your signed-in product experience yet."* plus a link to the Deep Scan panel. The audit is never blocked and no higher score is promised.
- **Deep Scan present** → *Authenticated product evidence — Ready*.
- **Deep Scan newer than the displayed audit** → *"New product evidence available"*. Re-running is the user's decision; **no automatic AI call is ever made**.
- The "Why?" disclosure resolves ids into product language (*Authenticated product: Dashboard detected*) rather than showing internal identifiers, and preserves polarity for `_not_observed` ids.

## Real evidence comparison (dogfood)

Built from the production snapshots of the Vibe Business project itself.

| | |
| --- | --- |
| v1 pack items | 60 |
| v2 pack items, no Deep Scan | 60 (identical ids and labels) |
| v2 pack items, with Deep Scan | 85 |
| `auth.*` items | 25 |
| Rendered pack size | 5,482 → 10,258 characters |

Authenticated evidence produced: 3 detected surfaces (dashboard, project workspace, integrations), 7 unobserved surfaces, an authenticated-area-reached fact, a reachable page count, a completeness fact, the generalized inspected paths, and 11 action controls.

Identity: the stored audit's hash `2fa4c86a…` differs from both the v2-with-Deep-Scan hash `6638e5d4…` and the v2-without hash `aee9d17c…`, so the old audit cannot be silently reused.

## Updated audit (run once, after approval)

One paid inference call, run by hand from the project page after the merge. **34 → 40 / 100**, five dimensions assessed, `business-evidence.v2` / `business-audit-prompt-v2`.

The stored `input_hash` came out as `6638e5d4d6181b49…` — identical to the value computed offline during the dogfood. Production identity and the offline computation agree exactly, which is what had to hold for the pre-Deep-Scan audit not to be silently reused.

| Dimension | Before | After | Status (unchanged) | Cites `auth.*` |
| --- | --- | --- | --- | --- |
| Product | 50 | 55 | assessable, medium | yes |
| Monetization | 8 | 10 | assessable, high | yes |
| Distribution | 28 | 32 | partial, medium | no |
| Conversion | 50 | 58 | assessable, medium | no |
| Retention | 35 | 45 | partial, low | yes |

### Is it more accurate?

Partly, and by less than +6 suggests.

**Retention is the real gain.** The previous audit's stated unknown was *"whether the authenticated app area is reachable and functional post-login"*. That is no longer an unknown — it was observed. The dimension moved from inference about code to direct observation, which is exactly the weight the rubric already gave a protected app area. Product improves for the same reason: its gap *"dashboard/app area not observable on the live site"* is gone.

**Distribution and conversion moved on identical evidence.** Neither cites a single `auth.*` id; their evidence is byte-identical across the two runs, yet they moved +4 and +8. That is run-to-run model variance and accounts for **+2.4 of the +6** — roughly 40% of the improvement is noise, not information. Worth remembering before reading any single-point score movement as signal.

**Monetization +2 is the wrong shape.** It cites `auth.surface.billing_not_observed` as corroboration that no revenue path exists — using *not observed* as support for absence, which is the inference the pack's wording exists to discourage. Two points is noise-level, but the reasoning is not what was intended.

### What held

- **Evidence integrity:** `validationNotes` is empty on both runs, so zero cited ids were discarded. No hallucinated `auth.*` id; all 7 distinct authenticated citations resolve against the 25-item pack.
- **The not-observed rule propagated.** The model's own limitations now include *"Deep Scan inspected only 6 signed-in pages, so unobserved surfaces are not established to be absent"* — the bounded-crawl caveat reached the output rather than dying in the prompt.
- **Token counting is exact,** not approximate: estimated input equalled actual on both runs (5,233/5,233 and 6,902/6,902).

### What to watch

The product summary says *"A working authenticated application exists"*. Presence was observed; "working" was not. The caveat did survive into that dimension's unknowns (*"whether the authenticated surfaces are functionally complete beyond being present"*), so the rule half-landed — but the summary sentence is the part a user actually reads. Tightening it means another `PROMPT_VERSION` bump and a re-run, so it is recorded here rather than changed.

### Cost

| | First audit (v1) | Updated audit (v2) |
| --- | --- | --- |
| Input tokens | 5,233 | 6,902 (+32%) |
| Output tokens | 5,218 | 5,684 |
| Thinking tokens | 2,637 | 3,166 |
| Provider cost | $0.0626 | $0.0706 (+12.8%) |
| Latency | 53.8s | 49.4s |

Authenticated evidence costs about **+1,700 input tokens and +$0.008 per audit** at the introductory Sonnet 5 price.

## Validation

`pnpm lint`, `pnpm typecheck`, `pnpm test` (948 → 1005 tests), `pnpm build` — all green. No real Anthropic call in tests.

The minimization tests were mutation-checked: reverting each sanitizer (raw paths, unfiltered labels, emitted headings) makes the corresponding test fail, so none of them passes trivially.

## Non-Goals

Opportunity Engine, credits, Stripe, async jobs, Browserbase lifecycle changes, entitlement changes, public crawler changes, repository analyzer changes, scoring weight changes, model or effort changes.

## Risks / Notes

- Score movement on evidence that did not change was measurable (+2.4 of +6 across two dimensions with no authenticated citations). Treat single-point differences between runs as noise.
- The "working authenticated application" phrasing above overstates presence as function; a future prompt version should tighten it.
- The production snapshot contains a duplicate `/app/connect/github/repositories` page entry (one authenticated link at 200, one repository route at 404). The analyzer's landed-path dedup fix postdates that scan; worth confirming on the next Deep Scan.

# Vibe Business — Intelligence Architecture Review

**Date:** 2026-08-21 · **Repository state:** `main` @ `bd7dc42` · **Method & limits:** see [Appendix A](#appendix-a--method-and-limits)

**The question this review answers:** *Are the Repository and Live Product scanners still the right shape for the product that now sits on top of them, and if not, what should be built — in what order?*

**The one-sentence answer:** The scanners are not the problem — what happens to what they collect is: a large share of both payloads is write-only while the audit, the planner and the coding agent visibly go hungry, the load-bearing artifact of the entire reasoning chain is never persisted, and nothing in the system can see change over time.

Findings are marked **CONFIRMED** (verified in code), **LIKELY** (strongly indicated, not conclusively proved) or **UNKNOWN**. Unmarked statements are CONFIRMED.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Current product architecture](#2-current-product-architecture)
3. [Current Repository Intelligence](#3-current-repository-intelligence)
4. [Current Live Product Intelligence](#4-current-live-product-intelligence)
5. [Architecture gaps](#5-architecture-gaps)
6. [Intelligence vision](#6-intelligence-vision)
7. [Repository Intelligence vNext](#7-repository-intelligence-vnext)
8. [Live Product Intelligence vNext](#8-live-product-intelligence-vnext)
9. [Unified Product Intelligence](#9-unified-product-intelligence)
10. [Product-specific intelligence](#10-product-specific-intelligence)
11. [Adaptive and learning intelligence](#11-adaptive-and-learning-intelligence)
12. [Historical intelligence](#12-historical-intelligence)
13. [Evidence and confidence model](#13-evidence-and-confidence-model)
14. [Context architecture](#14-context-architecture)
15. [Cost and performance](#15-cost-and-performance)
16. [Security and privacy](#16-security-and-privacy)
17. [What we should not build yet](#17-what-we-should-not-build-yet)
18. [Target architecture](#18-target-architecture)
19. [Gap matrix](#19-gap-matrix)
20. [Migration roadmap](#20-migration-roadmap)
21. [Sprint plan](#21-sprint-plan)
22. [Priority matrix](#22-priority-matrix)
23. [Recommended first sprint](#23-recommended-first-sprint)
24. [Open architecture decisions](#24-open-architecture-decisions)
25. [Final recommendation](#25-final-recommendation)
- [Appendix A — Method and limits](#appendix-a--method-and-limits)
- [Appendix B — Unrelated technical debt](#appendix-b--unrelated-technical-debt)

---

## 1. Executive summary

1. **The scanners are not the main problem — extraction of value from them is.** Both are deterministic, budgeted, evidence-carrying and security-conscious. But a substantial share of what they collect is *write-only* — persisted evidence arrays no consumer ever reads, SEO metadata such as `openGraph` and `structuredDataTypes` with zero readers, page metrics, brand tokens — while downstream consumers demonstrably lack signals they need today: pricing content, test infrastructure, `package.json` scripts, repository conventions, live facts inside the Execution Brief.

2. **Unified Product Intelligence already exists.** `product_profiles` / `product-profile.v1` joins repository, live and Deep Scan evidence under one input hash, with source priority and founder corrections. The question is not whether to build it but how far to extend it: the profile layer is *semantic* today (identity, audience, category), not *factual*. There is no shared fact layer with stable ids inside it, and no systematic contradiction detection.

3. **The evidence pack — the load-bearing artifact of the whole reasoning chain — is never persisted.** `P0`. Audit, opportunities and planner each rebuild it from *current* snapshots. Cited evidence ids inside a stored audit are dangling references into a document that no longer exists; only the input-hash gates hold the invariant together.

4. **Two parallel evidence-id vocabularies collide semantically.** `P0`. `repo.surface.<id>` means "present" in the understanding pack and "present *or* absent" in the audit pack, distinguished only by the label — violating the polarity-lives-in-the-id rule that `evidence-v2.ts` states in its own comments.

5. **Contradiction detection exists and never reaches the model.** `cross-check.ts` makes exactly four fixed repository-versus-live comparisons, consumed only by `intelligence-summary.tsx`. There is no `contradiction.*` evidence, and no live-versus-Deep-Scan or repository-versus-Deep-Scan comparison at all — even though "GitHub understands, live verifies" is the documented core thesis.

6. **There is no learning loop.** Outcome verification structurally cannot see agentic changes (`agentic_execution_v1` maps to `null`); business measurement has no data-source adapter; validation failures and context-usage metrics are recorded and read by no decision-maker. The one cleanly built learning layer, `economy/intelligence/`, is a deliberately unwired island — and architecturally the best model in the repository.

7. **History is stored completely and never read.** All four snapshot tables retain every version, and not one diff reader exists. Historical intelligence is therefore the cheapest large new capability available: the data is already there, versioned and immutable.

8. **Staleness handling is identity-based and consistent — but "latest" reads puncture it in three places.** `P0`. Review classification loads the *newest* repository snapshot instead of the one pinned to `baseSha`; the Execution Brief loads profile, live and plan-step rows unpinned while claiming to be a pure function of the spec — exactly the failure class ADR 0031 forbids ("a path that has moved is worse than no path").

9. **Cost is not a scanner problem.** Both scanners are effectively free (repository: 2–4 API calls, typically one downloaded file; live: at most twelve pages of static HTML). The expensive places are audit tokens and latency (~138 s, ~$0.18) and agent orientation turns. The right answer is to deepen the existing cheap-deterministic-first pipeline, not to add new model-driven scans.

10. **Recommended order:** correctness first, then foundation (persisted evidence pack, unified ids), then scanner v2 work (additive, no big bang), then fusion (facts, contradictions, archetype in profile v2), then history (diff engine), then adaptive loops. No knowledge graph, no vector database, no ML, no browser in the public scan.

---

## 2. Current product architecture

At the time of this review the top-level documents were badly out of date — `README.md` and `PRODUCT.md` described Sprint 0 while fifty-four sprints and thirty-eight ADRs documented a complete loop through the first real merge and the first production outcome verification. The code was the truth. *(This finding is the one this review's own sprint acted on; see [ADR 0039](../../decisions/0039-documentation-currency.md) and [Sprint 0056](../../sprints/0056-documentation-currency.md). The rest of this document is left as written.)*

The reconstructed as-built architecture:

```
User / founder
      │
      ▼
Project ── repository_connections ── project_founder_intent (3 enums + hash)
      │                              product_profile_corrections (7 fields, survive re-scans)
      ▼
UNDERSTAND — three separate snapshot worlds, all deterministic, zero AI
  repository_intelligence_snapshots    (repo-intelligence-v3, per commit SHA)
  live_product_intelligence_snapshots  (live-product-analyzer-v2, 24h freshness)
  authenticated_product_i._snapshots   (Deep Scan, one included, Browserbase)
      │
      ▼
product_profiles (product-profile.v1)          ← the fusion that already exists
  deterministic (capabilities / journey / signals / brand / tech)
  + ONE Haiku call (identity / audience / category), citation-validated
  + founder corrections as a read-time overlay
      │
      ▼
DIAGNOSE — business_readiness_audits (contract v6)
  Evidence pack v3 (profile + intent + scanner evidence), ONE Sonnet call
  9 lenses (health × materiality) → conclusions → 5 legacy dimensions
  interactive: needs_user / founder questions (deterministically chosen)
      │
      ▼
PRIORITIZE — opportunity_sets (ONE call, sourceConclusionKey lineage)
      │
      ▼
PLAN — action_plans (ONE call; the server owns executionSupport and capability;
  rule 57: no model field can ever carry a path, branch or code)
      │
      ▼
EXECUTE — execution_specs (immutable) → agent_execution_runs
  Execution Brief (compiled, ≤6 KB, freshness gate on the exact SHA)
  sandbox + tool gateway, ~90 observation columns per run
      │
      ▼
VERIFY — validation_runs (risk-adaptive depth) → preview → review_artifacts
  → change_approvals (bound to a commit) → change_merges (fast-forward, read-back)
      │
      ▼
MEASURE — change_outcome_verifications (only two SEO capabilities)
          business_outcome_measurements (no adapter → waiting_for_source)
      │
      ▼
LEARNING — does not exist (economy/intelligence: an unwired island)
```

Two corrections to the mental model most readers arrive with: **(a)** "product / business understanding" is not an idea but an existing versioned table, and **(b)** the arrow from independent validation back to business outcome and learning does not exist in code. The chain effectively ends at `merged` plus two hardwired SEO outcome checks.

What is remarkable about the current state is the *trust discipline*, which is unusually consistent: unknown is never bad, evidence citations are validated, being served beats being declared, approval binds to an immutable artifact identity, and database CHECK constraints are the last line. The intelligence weaknesses are almost never safety or care problems. They are exploitation and completeness problems.

---

## 3. Current Repository Intelligence

**Contract:** `repository_intelligence.v1` (payload shape, never changed) × `repo-intelligence-v3` (analyzer rules, bumped twice). Reuse key: `(project, commitSha, analyzerVersion, completed)`. A full scan runs on every analysis — there is no incremental path — but it is extremely cheap: roughly 2–4 GitHub API calls and typically exactly one downloaded file (`package.json`). Budgets: 20,000 tree entries, 40 file fetches, 256 KiB per file, 2 MiB total, 20 s. No AI.

**Detectors:** languages (9), frameworks (17 rules), package manager, runtime (`node` / `docker` only), integrations (27 rules across 6 categories), routes (Next.js App and Pages Router only; everything else `limited` or `none`), monorepo, 14 business surfaces, brand (assets, colours, typefaces). Evidence is an unkeyed `{kind, path, detail}` object — **stable evidence ids are minted not by the scanner but separately by every consumer.**

| Area | Current state | Strength | Weakness | Still appropriate? |
|---|---|---|---|---|
| Input | GitHub App, metadata + contents read; head → recursive tree → selective manifest fetches | Minimal, pinned, cheap access; path policy (sensitive / binary / generated) as the single gate | No webhooks; refresh is manual only | Yes — the access model stays right |
| Stack detection | 9 languages, 17 frameworks, package manager, 2 runtimes | Manifest + config corroboration, clean confidence tiers | Runtime effectively empty for anything non-Node; the integration confidence ternary degenerates (a dependency always yields `high`) | Yes, with fixes |
| Routes | Next.js only; cap 200; URL path + `sourcePath` | The core of every downstream capability — brief candidates, surface split, sitemap generator | Any non-Next.js product yields a snapshot the product can do nothing with | For the V0.1 focus yes; as a permanent assumption no |
| Business surfaces | 14 fixed ids, all always emitted (present / absent) | Absence is a first-class fact — the most valuable row for "create a surface" steps | Archetype-blind (the same 14 for SaaS, blog and API tool); `detected: false` misleadingly carries `confidence: "high"` | Idea yes; the set must become archetype-dependent |
| Brand | Assets, colours, typefaces from tree + CSS tokens | Evidence-disciplined, ramp and state guards | `oklch`/`hsl`/`rgb` colours invisible; `tokenSources` and `token` read by nobody | Yes, small gaps |
| Evidence model | `{kind, path, detail}`, no ids, no lines | Never source text, only paths — data minimization holds | No snapshot-local identity; `Evidence.kind` is never read by any consumer; ids are minted twice downstream | **No** — ids belong in the snapshot |
| Persistence | One table, JSONB, partial-unique in-flight guard, RLS | A failed row can never displace a good snapshot; reuse by SHA | JSONB is cast without validation; `schema_version` is written and never read; stuck `analyzing` rows block permanently via the unique index (no reaper) | Pattern yes; hardening needed |
| Versioning | An analyzer bump means old snapshots stop being reused, and nothing else | Simple; has worked twice (v1→v2→v3) | No version dispatch on read; a brand-less v2 payload is served as a v3 type (the only guard is one `?? {}`); fixtures claim three analyzer versions simultaneously | For additive change yes; the read guard is missing |
| Deterministic vs. AI | 100% deterministic | Reproducible, free, testable | — | **Yes, keep unconditionally** |
| Incremental | None; snapshot reuse by SHA | Reuse makes the common case free | Every new commit is a full analysis (but a full analysis is ~3 API calls) | Yes — incrementality barely pays here (§20) |
| Consumers | ~80 files: audit pack, understanding, brief compiler, capability gates, validation profiles, Deep Scan candidates | Broad and genuinely used — the snapshot is the backbone | `scriptNames` is parsed and discarded, so the sandbox re-parses `package.json` in two places; only the execution path checks staleness | Yes; close the gaps |

**The most important documented precedent** is the robots.txt false positive recorded in the project history: the detector cited Vibe's *own* robots parser as proof of a robots.txt in the customer repository, the opportunity engine built a confident false statement on top of it, and nothing downstream could catch it because the cited evidence id genuinely existed. The fix was an analyzer bump. The learning is written into the repository: *opportunity quality is bounded by evidence quality.* That is the strongest argument for treating scanner quality as a P0/P1 investment — every hour spent there multiplies through the whole chain.

---

## 4. Current Live Product Intelligence

**Contract:** `live-product-intelligence.v1` × `live-product-analyzer-v2`. Static HTTP/HTML, no browser, no JavaScript, fully deterministic. SSRF-hardened `safeFetch` (DNS pinning, manual redirects, every hop revalidated), genuine robots.txt compliance including crawl delay. Budgets: 12 pages, depth 2, 6 MiB, 20 s, priority-ordered frontier (pricing 10 > signup/login 9 > …). Reuse: 24-hour freshness per origin, honestly justified — a website has no commit SHA.

Deep Scan (`authenticated-product-intelligence.v1`): Browserbase plus Playwright CDP against a session the user signed into themselves, strictly read-only (GET only, dialogs dismissed, downloads discarded), 8 pages / 90 s, no screenshots, no DOMs, entitlement enforced by a partial unique index rather than a flag.

| Area | Current state | Strength | Weakness | Still appropriate? |
|---|---|---|---|---|
| Crawl | BFS over sitemap + links, same-origin, priority frontier | Exemplary budget discipline; degradation always typed (`partial` + reason) | Synchronous in the request (20 s budget versus Vercel `maxDuration` unresolved — LIKELY conflict); no durable-operation path | Mechanics yes; execution location questionable |
| Page analysis | Homepage deep (metadata, all 8 SEO signals, full brand); every other page shallow (title, counts, CTAs, surfaces) | Clear cost control | **Strongly homepage-centric:** `/pricing` is fetched but yields only a title and CTAs; no page-type-specific extractor; headings are parsed (up to 40 per page) and thrown away | **No** — the largest single gap |
| Surfaces | 12 ids from path, title, headings, redirects, forms; 10 also inferable link-only | Multi-source classification, English and German | Homepage only when `path === "/"`; `detected: false` yields `confidence: "high"`, persisted misleadingly | Yes, with fixes |
| SEO | 10 boolean presence signals, homepage only | Honestly small | No quality dimension (lengths, duplicates, hreflang); `robots_meta: present` counts as a positive, so a `noindex` page reads as an SEO success; `robots_txt: present` regardless of content | No — partly wrong semantically |
| Conversion | 8 CTA categories (rule table), primary-CTA ranking, 6 form types (field types only) | Form data minimization is exemplary | No pricing content — prices, plans, currency — which for a monetization product is the largest gap; social proof and trust unmodelled | Partly |
| Observation vs. interpretation | The analyzer observes; `human-view.ts` interprets deterministically; `cross-check.ts` makes business claims | The boundary is documented and disciplined, and the interpretation is deterministic and testable | Primary-CTA ranking is a value judgement that promotes understanding to `confirmed`; confidence tiers are encoded opinions | Largely yes — make the layers explicit (§6) |
| Deep Scan | 10 auth surfaces, navigation, actions, empty states; a second minimization boundary in the audit pack (`:id` generalization, headings discarded) | Excellent security model; evidence polarity in the id (`auth.area.not_reached`) | Effectively exactly one scan per project forever (credits unreachable), so change detection is structurally impossible; no reuse mechanism | Model yes; economics block use |
| Persistence | Same snapshot template as the repository side; unbounded history | Consistent pattern | `crawl.robotsRespected` is hardcoded `true` — a claim dressed as an observation; ~15 fields have no external reader | Yes; remove or use the ballast |
| Diff / change | None | — | A re-scan that loses the pricing page produces a new audit with no note that anything disappeared | No — a core gap (§12) |
| SPA detection | None | — | A fully client-rendered product yields almost nothing, *without warning*; the audit then scores emptiness as a state | No — violates the spirit of unknown ≠ bad |

### Where the three layers live today

| Layer | Location today | Assessment |
|---|---|---|
| Observation | Snapshot payloads (surfaces, signals, pages) | Clean, with the two exceptions above (`robotsRespected`, absence confidence) where a claim is persisted as an observation |
| Interpretation | `human-view.ts` (deterministic), product profile (Haiku), audit lenses (Sonnet) | Separated, but unmarked: in evidence pack v3, model interpretations (`profile.*`) and measurements (`live.*`) sit in one flat list, distinguished only by prose in the fence. A blocker resting solely on `profile.identity.promise` rests on an inference, and nothing flags it |
| Business implication | Audit conclusions (root problem → explanation → why it matters), lens materiality | Well developed (contract v6); the layer is there — what it lacks is the explicit fact/signal layer beneath it |

---

## 5. Architecture gaps

### The diagnostic questions

**Were the scanners built when Vibe Business was much smaller?** Yes. The repository scanner is Sprint 2, before audit, profile, planner and agent existed; the live scanner is Sprint 3. Nine major consumers have appeared since, and each improvises its requirements *around* the scanners: two evidence-id factories, duplicated `package.json` re-parsing in the sandbox, a string-parsing label resolver, a test-directory heuristic duplicated in two places.

**Which assumptions are obsolete?** (a) "Consumers mint their own evidence ids" — two vocabularies now collide. (b) "The snapshot serves the audit" — the Execution Brief compiler is now the most demanding consumer and needs facts (scripts, conventions, live state) that were never collected. (c) "Homepage-deep is enough" — Deep Scan and a multi-move product need page-type-specific understanding. (d) "One snapshot per point in time is enough" — outcome verification and the progress narrative need deltas.

**What data is missing for audit, planner, execution?** Audit: pricing content, SEO quality, an SPA warning, contradiction evidence, deltas since the last audit. Planner: the titles of the other blockers (the narrow context is deliberate, but the absence of dependency context is real). Execution: `scriptNames`, test framework, conventions, live facts — the `live_product_scan` fact slot is declared, ranked and labelled, and emitted by no code path — and prior knowledge from earlier runs.

**What is collected and barely used?** Repository: `Evidence.kind`, `brand.tokenSources`, `colors[].token`, `repository.private`, `monorepo.packages`, `metrics.candidatesSelected` (whose value is also misnamed). Live: `openGraph`, `structuredDataTypes`, `canonical` and `language` values, all `crawl.*` detail fields, `headingCount`/`linkCount`/`bytes`, `conversionPathLinks`, `FormSignal.fieldTypes`, and the entire persisted evidence arrays. Auth: `mainHeading` (deliberately), `tableCount`, `candidateSources`, `browserSessionDurationMs`.

**Where is data reconstructed more than once?** Evidence ids (two factories plus a string parser); the evidence pack (rebuilt three times, never stored); currency logic (three implementations); presentational prefix lists (two, already diverged); renderable path patterns (two, diverged); `MUTATING_CHANGE_KINDS` (four copies); `TEST_FILE_PATTERN` (two copies); the test-directory heuristic (two copies); `package.json` parsing (snapshot plus twice in the sandbox).

**Where does interpretation happen too early?** Rarely — the discipline is good. The residual cases: primary-CTA ranking becomes `confirmed` downstream; absence confidence is `high`; `robotsRespected` is a literal; and `live.heading.*` ids actually carry CTAs, so the comment and the code contradict each other — the intended "single most useful signal", real headings, was never available.

**Where are learnings from agent runs and validations missing?** Everywhere. Around ninety observation columns per run, thirty-eight event types, validation results, outcome checks — none of it feeds any future decision except the unwired economy island. The code even names the feedback verbatim: a validation failure on a run whose agent verification was `low` "is exactly the signal that would justify moving a task class up a mode". It is not implemented.

### Classified gaps

| # | Gap | Class | Evidence |
|---|---|---|---|
| G1 | Evidence pack never persisted; citations in stored audits are dangling | P0 | `opportunities/runner.ts`, `operations/action-plans/execution.ts` |
| G2 | Evidence-id polarity collision between the understanding and audit vocabularies | P0 | `business-audit/evidence.ts` vs. `product-understanding/evidence.ts` |
| G3 | Review classification loads the *latest* snapshot instead of the one pinned to `baseSha` | P0 | `review/classification-inputs.ts` |
| G4 | Brief "determinism" is false: latest profile / live / plan rows; usage metrics may be measured against a brief the run never received | P0 | `execution-context/service.ts`, `agent-execution/execution.ts` |
| G5 | Presentational prefix lists diverged (`live.conversion.` only in `depth.ts`) while the comment claims otherwise; consequence: `medium` agent verification but `fast` validation for the same class | P0 | `execution-context/verification.ts` vs. `validation/depth.ts` |
| G6 | Persisted misstatements: `robotsRespected: true` hardcoded; absence surfaces at `confidence: "high"`; `live.heading.*` carries CTAs | P0 | `analyzer.ts`, `signals.ts`, `product-understanding/evidence.ts` |
| G7 | Stuck `analyzing` rows block permanently via the partial unique index; no reaper, `already_running` with no way out | P0 | `repository-intelligence/store.ts` and its migration |
| G8 | JSONB cast to the current type without runtime validation or version dispatch; v2 snapshots without `brand` served as v3 | P0 | `store.ts`; only guard in `product-understanding/evidence.ts` |
| G9 | No shared fact/signal layer with stable ids; scanners emit raw signals and ids are minted twice downstream | P1 | §3, §6 |
| G10 | Cross-checks reach neither the evidence pack nor the model; live↔auth and repo↔auth missing entirely | P1 | `cross-check.ts`; sole consumer `intelligence-summary.tsx` |
| G11 | No snapshot diffs, no regression detection, no change awareness — history sits entirely unused | P1 | every store: `getLatest*` only |
| G12 | Outcome verification structurally impossible for agentic changes (`agentic_execution_v1: null`); business measurement has no adapter | P1 | `execution/outcome-contract.ts` |
| G13 | Live analysis homepage-centric; no page-type extractors; no pricing content; headings discarded | P1 | §4 |
| G14 | Archetype-blind analysis: the same surfaces, lenses and priorities for every product; `PRODUCT_CATEGORIES` exists and steers nothing | P1 | `product-understanding/schema.ts` |
| G15 | Execution Brief without live facts, conventions or test/script knowledge; the agent pays for rediscovery (ADR 0031 only half redeemed) | P1 | `brief.ts`; sandbox re-parsing |
| G16 | SPA/JS rendering not detected — empty results without warning violate the spirit of unknown ≠ bad | P1 | Sprint 0003, still open |
| G17 | SEO signals partly wrong semantically (`noindex` as a positive), no quality dimension | P2 | `human-view.ts` |
| G18 | Missing repository detectors: tests, CI, e-mail, feature flags, queues, i18n; runtime detection effectively empty | P2 | Sprint 0020 known deviations |
| G19 | Live crawl synchronous in the request; 20 s budget versus serverless timeout unresolved | P2 (LIKELY) | Sprint 0003 |
| G20 | Deep Scan economically frozen (one scan forever), blocking all authenticated change intelligence | P3 | `entitlement.ts` |
| G21 | Documentation drift: README, PRODUCT, ARCHITECTURE and several module READMEs describe a product state ~50 sprints old | P2 | *Addressed by [Sprint 0056](../../sprints/0056-documentation-currency.md)* |

---

## 6. Intelligence vision

The six-layer pipeline is right as a *thinking model*, and four-sixths of it already exists in the repository — implicitly, with a gaping hole in the middle:

```
RAW OBSERVATION      ✅ snapshots (repo / live / auth) — clean, deterministic
NORMALIZED FACT      ❌ missing as a layer — improvised by two evidence factories
DERIVED SIGNAL       ⚠️ scattered (cross-check, human-view, deriveBusinessSignals)
INTERPRETATION       ✅ product profile (semantic half, citation-validated)
BUSINESS IMPLICATION ✅ audit lenses + conclusions (health × materiality)
RECOMMENDATION       ✅ opportunities → moves → action plans
```

**Recommendation: adopt the model, but as three contracts rather than six services.** Six physical layers would be over-engineering — the upper three already exist as paid model calls with working validation, and cutting them apart would break the one-call-per-operation cost contract. What is missing is precisely the middle:

1. **Fact layer (new, deterministic).** Each scanner emits, alongside its payload, normalized facts with stable ids, polarity in the id, source, categorical confidence and evidence references — exactly what `business-audit/evidence*.ts` and `product-understanding/evidence.ts` each invent at runtime today. One id factory, in the scanner module, shared by all.
2. **Signal layer (new, deterministic).** Cross-source derivations: contradictions (repo ↔ live ↔ auth), deltas (snapshot *n* ↔ snapshot *n−1*), composite signals (`monetization_surface_missing` = no live pricing ∧ no live checkout ∧ no payment signal in the repository). Signals are code, never a model — precisely the kind of conclusion where rules beat inference, which is the principle `product-understanding/README.md` already states: rules answer what rules can answer.
3. **Interpretation upward is unchanged**, but with marked provenance: every pack row carries its layer (`measurement` / `derived_signal` / `model_interpretation` / `founder_statement`), so a blocker resting only on interpretations is deterministically detectable. Today only prose in the fence does that.

> **The guardrail.** The vision is not "collect more intelligence" but **one shared, referenceable product truth**: a fact is collected once, gets an identity, and audit, planner, agent, validation and UI cite the same identity. Everything else — archetype, history, learning — consumes that truth rather than founding a new one.

---

## 7. Repository Intelligence vNext

Target: `repository_intelligence.v2` (schema, additive) × `repo-intelligence-v4` (analyzer). No rewrite — the scanner core (reader port, budgets, path policy, candidates, detector purity) stays. Every new signal below is justified by the downstream decision it improves; signals without such a justification were deliberately left out.

| New signal | Source (already inside the budget) | Which decision improves? |
|---|---|---|
| Facts + stable ids in the snapshot | existing detections | Ends the duplicate id factory (G2/G9); audit "why?" disclosure without string parsing; the foundation for diffs |
| `scripts` (names, never bodies) | already parsed, then discarded | The validation orchestrator and agent execution re-parse `package.json` in the sandbox today; the brief can evidence `check_command` precisely |
| Test infrastructure (framework, config, directory) | tree + manifest dependencies | Replaces the directory heuristic duplicated in two places; agent verification (targeted tests) and the validation profile decide informed rather than by regex guess |
| CI presence (`.github/workflows`, provider) | tree | The merge dialog warns generically about customer CI/CD today; with evidence the warning becomes concrete |
| E-mail / transactional (Resend, Postmark, SendGrid…) | manifest dependencies | The retention lens is almost always `insufficient_evidence`; a lifecycle-e-mail signal is the cheapest genuine retention indicator |
| Feature flags, queues/cron, i18n | manifest dependencies + configs | Operational maturity and the scalability lens; the planner avoids moves that duplicate existing infrastructure |
| Analytics *integration depth* (snippet vs. event-tracking dependency) | dependencies | The measurement lens distinguishes "analytics installed" from "events instrumented" |
| AI product signals (provider SDKs, agent frameworks) | manifest dependencies | Archetype detection (§10) and a cost lens for AI products — the core ICP builds AI products |
| Runtime completion (python/go/rust/php/ruby from manifests already fetched) | manifests already fetched | Honest `validation_not_supported` with a reason instead of an empty runtime array |
| Route detection for further file-convention routers (SvelteKit, Nuxt, Astro, Remix) | tree, same pattern as Next.js | Surface detection and brief candidates for the most common vibe-coding stacks. Execution capabilities may follow but need not — detection ≠ execution support |

**Corrections to the existing code:** fix the integration confidence ternary (dependency + config → high, dependency → medium, config → low); stop giving absence detections `confidence: "high"`; populate `metrics.candidatesSelected` correctly; move `MAX_ROUTES` into the budgets; normalize `oklch`/`hsl`/`rgb` colours. **Harden the read path:** a `parseStoredSnapshot` with version dispatch that lifts older payloads to the current type or marks them `legacy`, instead of a blind cast; and a reaper for stuck `analyzing` rows.

**Explicitly not:** more file fetches than necessary, source analysis of individual files, any LLM component in the scanner, or webhook-triggered automatic scans (a staleness flag would be conceivable later; rule 60 forbids paid automatic refreshes regardless).

---

## 8. Live Product Intelligence vNext

Target: `live-product-intelligence.v2` × `live-product-analyzer-v3`. Core principles untouched: the `safeFetch` boundary, no browser (which would require an ADR), nothing raw persisted, budgets central. The change is a **page-type-aware extractor registry** instead of "homepage deep, rest shallow":

```
classifyPage → PageKind → ExtractorRegistry
  pricing   → PricingFacts    (plan count, price amounts + currency as numbers,
                               billing period, free-tier/trial mention, CTA per plan)
  any page  → PageSeoFacts    (title/description + lengths, canonical, robots meta
                               WITH noindex semantics, og present, h1 text ≤120)
  any page  → headings[] ≤8   (the ones parsed and discarded today; the
                               product-understanding filter moves ahead of persistence
                               as safeText)
  legal     → existing presence + imprint/privacy/terms differentiation
  homepage  → as today (metadata, brand) + social-proof counting
              (testimonial and logo-strip structural patterns, counts only)
  global    → renderingSignal: "static" | "hydrated" | "client_rendered_suspect"
  global    → responseTimings (TTFB per page from existing fetches),
              brokenLinkCount (internal only, from status codes already seen)
```

| New signal | Downstream justification |
|---|---|
| PricingFacts | Monetization is the central product dimension and `pricing` is a boolean today. "A pricing page exists but names no price" and "three plans, no free tier" are completely different audit findings and completely different moves |
| Per-page SEO + noindex semantics | Fixes G17, where `noindex` currently counts as an SEO plus. SEO moves are the only capabilities executable today, and their evidence base stops at the homepage |
| Headings (bounded, filtered) | The understanding module calls headings "the single most useful signal" and receives CTAs under a false id today (G6). Real headings improve category, promise and audience inference at the root of the chain |
| renderingSignal | Fixes G16: an empty scan of a client-rendered product is reported as `partial` with a reason instead of "the product has nothing" — the unknown-≠-bad rule applied to the crawler itself |
| responseTimings / brokenLinkCount | Free from requests already made; a cheap performance proxy for the audit without Lighthouse infrastructure. Not a Core Web Vitals substitute and not labelled as one |
| Social-proof structure (counts) | The conversion lens asks about trust and it is unmodelled today. Structural counting only, never quotation text |

**Corrections to the existing code:** derive `robotsRespected` rather than hardcoding it; fix absence confidence; recognize the homepage for `/en/`-style roots (landing-depth-0 rather than a path literal); unify `pagesDiscovered` semantics. **Execution location:** the crawl belongs in a durable operation in the medium term (ADR 0013 exists for exactly this) — the 20 s budget competes with the serverless timeout (LIKELY), and v2 extractors sharpen that. **Deep Scan:** leave the contract unchanged; the blockage is economic, not architectural.

---

## 9. Unified Product Intelligence

**Yes — but by extending the existing `product_profiles`, not by adding a new fusion object.** ADR 0031 already says so: `product_profiles` *is* the versioned product intelligence snapshot, joining the repository, live and authenticated scans under one schema, builder and evidence version with an input hash. A second fusion object would be exactly the second truth system the ADR forbids.

What the profile lacks to fill that role fully — `product-profile.v2`, additive:

- **`facts`**: the normalized fact view of both scanners (ids, polarity, source, confidence, evidence refs), implicit in two runtime factories today. Sources stay separately visible: every fact carries `source: repository | live_product | deep_scan | founder`. Fusion merges statements, never provenance — the existing `SOURCE_PRIORITY` principle extended to facts.
- **`contradictions`**: the signal layer's output (§6) — repo ↔ live (the four existing checks as a starting set), live ↔ auth (no public pricing ∧ in-app billing present, the most valuable monetization contradiction and uncomputed today), repo ↔ auth. Each becomes a `contradiction.*` evidence row so the model does not have to re-derive it from raw rows.
- **`archetype`**: §10.
- **Execution and validation history: deliberately *not* in the profile.** The profile describes the product; runs describe Vibe's work on it. The link happens through context views (§14) and the diff engine (§12), not by embedding — otherwise every agent run would invalidate the profile hash and with it audit reuse, which would be economically wrong.

The canonical example then works exactly as intended: `repo.integration.stripe` ∧ `live.surface.pricing.not_found` ∧ `live.surface.checkout_billing.not_found` ∧ `intent.primary_goal = monetize` ⟶ signal `contradiction.payments_not_exposed` — deterministic, citable, with all four source references. The interpretation ("payments exist technically but are not exposed") stays with the audit; the signal only hands it the named, pre-computed contradiction.

---

## 10. Product-specific intelligence

**Recommendation: hybrid — deterministic archetype candidates, model confirmation inside the already-paid understanding call, categorical confidence.**

Purely rule-based would be reproducible and free but fails at the edge cases (marketplace versus two-sided SaaS; a content product with a login) — precisely the cases where the archetype choice steers the analysis most. Purely LLM-based would violate the proven principle that rules answer what rules can answer, and would fluctuate run to run; the documented score variance (34 → 40 → 41 → 38 on partly identical evidence) shows what happens when a *steering* quantity becomes model-dependent. Hybrid costs nothing: a deterministic scorer proposes one or two candidates with evidence, and the existing understanding call — which already picks a `category` from `PRODUCT_CATEGORIES` — confirms or dissents *within the candidate set*. Dissent yields `confidence: low` with both candidates visible. No new call, no new model authority.

```
archetype: {
  id: "b2b_saas" | "consumer_app" | "marketplace" | "ecommerce" | "api_or_devtool"
    | "ai_agent_product" | "content_or_lead_site" | "internal_tool" | "unknown",
  confidence: "high" | "medium" | "low",        // categorical, never 0.87 (§13)
  evidence: [factId, ...],
  candidates: [{id, score, evidence}],
  decidedBy: "rules" | "rules+model_confirmed"
}
```

| The archetype may steer | Mechanism |
|---|---|
| Scanner expectation lists | Which surfaces count as *materially expected*. The absence of an unexpected surface produces no signal — that reduces noise rather than adding data |
| Signal materiality | Composite signals carry an archetype prior: `monetization_surface_missing` is `not_material` for `content_or_lead_site` and `now`-suspect for `b2b_saas` |
| Audit rubric context | One pack row (`profile.archetype` plus evidence) and archetype hints on the rubric side. The nine lenses stay universal; their materiality weighing gains context. No per-archetype rubric forks — that is a maintenance explosion |
| **Not:** scores, execution, validation | An archetype is an interpretation. In the spirit of rule 54 it authorizes nothing and relaxes no safety classification |

---

## 11. Adaptive and learning intelligence

The loop is physically severed in three places today (G12), and the right answer is explicitly **not machine learning** but the four deterministic mechanisms the repository has already sketched for itself:

1. **Declarative outcome contracts for agentic changes.** Today `agentic_execution_v1` maps to `null`. Next: the step's surface requirement — which already exists and is evidence-based — produces an *observable expectation* ("after merge, surface X / meta tag Y exists at path Z"), frozen before observation and checked by re-reading the same paths. That is the existing `expected_outcome` pattern from ADR 0020, generalized from two SEO checks to evidence-derivable checks. Where no expectation is derivable, `outcome_not_supported` honestly remains.
2. **Post-merge re-scan diff as delivery evidence.** After a verified merge, a live re-scan plus snapshot diff (§12) is the generic answer to "did the change arrive?" — *new: pricing page; changed: hero CTA; regression: SEO title missing*. Cost: one free crawl.
3. **Validation feedback on classifiers.** The code names it itself: a validation failure on a run whose agent verification was `low` is the signal to raise the task class. Mechanics follow the economy-intelligence model: cohort statistics (change kind × evidence family × outcome) → a *scalar, versioned* floor correction, exactly neutral below a sample floor, reproducible from a snapshot. No online learning, no weights — one number with provenance.
4. **Context-usage feedback on the brief.** `candidatesRead`, `filesReadOutsideContext` and `repeatedFileReads` are already recorded per run and read by nobody. First stage: a report of which fact types are read and which never are. Second stage: a versioned cap adjustment (`maxCandidates`) per cohort — again a scalar, never a model.

> **The pattern is already proven in the repository.** `economy/intelligence/` shows the right form of a learning loop: the estimator sees only pre-execution inputs (enforced by a source scan), learning enters it as a reproducible scalar, every prediction carries its own snapshot, and reconciliation proposes and never activates. Adaptive intelligence means copying that pattern onto verification floors and brief caps — not inventing a new one.

Analytics-based learning ("conversion improved, therefore the recommendation was good") stays in the future: it presupposes the business-measurement adapter, and even then the causality boundary cemented in code (`hasCausalEvidence()` returning false) holds — observed coincidence is reported, never claimed as cause.

---

## 12. Historical intelligence

The preconditions are unusually good: all snapshots are immutable, versioned and fully retained. Only the reader is missing. Proposal: a deterministic **diff engine** as its own small module (`intelligence-diff.v1`), computed on demand between two snapshot ids of the same table, optionally cached per pair — not a new truth system, since the diff is a pure function of two stored rows.

```
SnapshotDiff {
  kind: "repository" | "live_product",
  from / to: snapshotId + (commitSha | analyzedAt),
  comparable: boolean,          // false across analyzer version boundaries — then
  incomparableReason,           //   NOT diffed: a contract change is not a
  added:    [factId...],        //   product change
  removed:  [factId...],
  changed:  [{factId, from, to}],
  regressions: [factId...],     // removed ∩ facts classified as positive
}
```

Consumers, in order of value: **audit context** ("since the last audit: +pricing page, −canonical" as `delta.*` rows, so the model judges movement rather than only state); **regression detection after merge** (§11.2); **the planner** (a move whose target state the diff shows already reached is recognized as done rather than re-planned); and **a product progress UI**.

Non-goals: diffs across analyzer version boundaries (incomparable by construction — exactly the `auditScoresComparable` rule that already exists for audits), diff time-series aggregation, trend statistics. A diff between *adjacent comparable* snapshots covers all four consumers.

---

## 13. Evidence and confidence model

### Evidence

1. **Ids originate at the source.** Scanners mint fact ids; consumers cite them. The evidence-v2 polarity rule becomes universal: `repo.surface.pricing_page` versus `repo.surface.pricing_page.not_found` — an id is self-describing without its label.
2. **The pack is persisted.** An audit stores the pack (or its fact-id set plus a pack hash) it ran against. Citations in stored documents become resolvable rather than dangling, "why?" disclosure needs no string parsing, and the road to a later evidence graph is open without building one today.
3. **Every pack row carries its layer** (`measurement | derived_signal | model_interpretation | founder_statement`) — the observation/interpretation split as data rather than as prose.

### Confidence

**Stay categorical. Reject numeric confidence.** A `confidence: 0.96` would be exactly the false mathematical precision to avoid, and ADR 0031 §5 already decided and justified this: nothing in the pipeline measures a probability, so a number would assert a precision no part of the system earns. Instead:

- **Level:** `high | medium | low`, the existing scale, with the semantic repairs named in §7 and §8.
- **Corroboration separate from level:** `sources: [repository, live_product]` plus an evidence count travel with the fact. Two independent sources are a *different* fact from one — but they are enumerated, not multiplied, and deduplication comes before corroboration, so a fact stated twice does not read as two sources.
- **Contradiction as its own state:** `contradicted` is not a low confidence level but a status referencing the contradiction signal. Conflicting evidence is information, not noise.
- **Founder claims:** keep the existing provenance-priority model — `user_confirmed` wins the *presentation* but never overwrites a measured fact. New: a founder claim contradicted by a measured fact produces a contradiction signal ("unverified founder claim") instead of winning silently. Today the correction wins invisibly, and corrections are excluded from both reuse hashes, so audit and profile can diverge while `upToDate: true` is reported.

---

## 14. Context architecture

The context views already exist de facto — they are simply not named, and exactly one is structurally missing:

| View | Reality today | vNext |
|---|---|---|
| AuditContext | Evidence pack v3: profile first, scanner evidence behind, priority trimming; ~18k input tokens | The persisted pack v4, plus `contradiction.*`, `delta.*`, archetype and layer markers. Already cut correctly |
| PlannerContext | Deliberately narrow: one conclusion, its lenses, its cited evidence; measured $0.047 versus $0.18 | Keep. The one addition: the *titles* of the other blockers, one line each, so a plan can spot duplicate work without inheriting audit context |
| ExecutionContext | The compiled brief, ≤6 KB, freshness gate — conceptually the best view in the system | Fix pinning (G4), fill in live facts and convention/script facts (G15), calibrate caps from usage feedback (§11.4) |
| ValidationContext | Implicit: the depth resolver and profiles read spec, paths and snapshot directly | Make it explicit: one shared classification library (presentational lists, path patterns, change kinds — two to four drifting copies today) *is* the ValidationContext |

Recommendation: document the views as named, versioned contracts (inputs, budget, version, persistence rule) — but build no new runtime abstraction over them. The value is in the contract and in pack persistence, not in a view framework.

---

## 15. Cost and performance

| Operation | Class | Cost | Latency |
|---|---|---|---|
| Repository scan | cheap | ~$0 (2–4 API calls) | seconds |
| Live scan | cheap | ~$0 (≤12 fetches) | ≤20 s |
| Deep Scan | medium | browser seconds (~11 s measured) | ≤90 s |
| Product understanding | medium | Haiku, ≤24k in / 6k out | ~11 s |
| Business audit | expensive | ~$0.18 | ~138 s |
| Opportunities / action plan | expensive | ~$0.05 / ~$0.047 | ~40 s each |
| Agent run | expensive | $0.14–$0.35 (cache tokens 55–70% of it) | minutes |

The cheap-deterministic-scan → signal-detection → targeted-expensive-analysis pipeline **is the existing architecture**, and almost everything in this plan reinforces rather than changes it:

- Facts, signals, contradictions, diffs and archetype candidates are all deterministic and all ~$0.
- Not one new LLM call appears in the entire vNext scanner plan; the archetype rides along in the paid understanding call.
- The real cost risk is upstream: the audit rubric grows every sprint (documented budget coupling of ~9.8 ms per output token; two discarded runs at $0.20 each), and agent runs scale superlinearly with turns. Better facts *lower* both — sharper evidence shortens model enumeration, and a filled brief shortens orientation turns, which is ADR 0031's own arithmetic.
- Diffs are cheaper than re-reasoning: "nothing has changed" as a deterministic answer saves the most expensive question there is.
- **Incremental scans:** not worth it for the repository scanner — a full scan costs 2–4 API calls, so an incremental path buys complexity to save almost nothing. For live, the diff supplies the incremental *evaluation* while the crawl stays full and cheap. Verdict: incremental analysis yes, incremental collection no.

---

## 16. Security and privacy

The existing boundaries are strict and are held — in places more strictly than documented (Deep Scan double sanitization; forms as types only; query strings never persisted). vNext requires exactly four new judgements:

| vNext feature | Risk | Boundary |
|---|---|---|
| Persisting headings | Headings can carry names or PII — the Deep Scan incident (`mainHeading: "planner-agent"`) | *Public* pages only, where headings are by definition published marketing; still a `safeText` filter (e-mail / URL / UUID / long-digit shapes) *before* persistence rather than only before the prompt; ≤8 per page, ≤120 characters. Authenticated headings stay discarded |
| PricingFacts | Prices are uncritical; surrounding text is not | Numbers, currency code, period, plan count, boolean trial/free flags, CTA category only. Never plan description text |
| Secret *existence* in the repository | "`STRIPE_SECRET_KEY` exists" is valuable evidence; contents are off limits | Rule 28 already covers it: `.env*` *existence* is observable, contents never fetchable, and the path policy enforces that. An `env_file_present` fact is permissible; a variable-*name* scan would not be, since it requires fetching a sensitive file's contents |
| Diff persistence | Diffs reference only fact ids | No new risk, as long as facts themselves are minimized — the diff inherits the source's minimization |

Two existing points deserve hardening regardless: the unvalidated JSONB cast (G8, also an integrity matter — a manipulated payload would flow unchecked into prompts) and the three divergent RLS postures of the usage ledgers.

---

## 17. What we should not build yet

- **Knowledge-graph or graph-database infrastructure.** The evidence graph already exists almost completely as a *data model*: foreign-key chains plus `sourceConclusionKey` plus input hashes describe fact → audit → opportunity → move → plan → run → validation → merge → outcome. What is missing is the persisted pack and a read model that *displays* the chain. A graph database would store the same information more expensively. Traversability yes, later, as a read model; graph infrastructure no.
- **Vector database / embeddings.** Not one use case in this plan needs similarity search, and the migration comments forbid it explicitly. Retrieval happens by id and hash.
- **ML training pipeline / learned confidence.** One customer, roughly nine runs. Any learned quantity would overfit Vibe Business itself — the history warns about precisely this.
- **Full-site crawler / raising budgets to "everything".** Twelve prioritized pages with page-type depth beat two hundred shallow pages for every downstream decision. Rule 39 stays right.
- **Browser automation in the public scan.** ADR-protected (rule 38). The `renderingSignal` delivers the finding "a browser would be needed here" as an honest `partial`; deciding to introduce headless rendering because of it is its own ADR with its own security analysis, not a scanner feature.
- **Extending Authenticated Product Intelligence.** The model and security architecture are good; the blockage is credit economics. Until re-scans are affordable, authenticated intelligence would hold exactly one data point per project, forever. Logged-in *journey* simulation stays out entirely: mutating interactions violate the read-only policy that is the feature's most important trust anchor.
- **An over-complex confidence engine** (Bayes, weight fusion, numeric scores). §13: categorical plus corroboration plus contradiction is enough, and anything beyond feigns precision nothing measures.
- **Webhook-driven automatic re-scans.** Push events as a *staleness flag* would make sense later; automatically triggered analyses collide with the cost model and rule 60.
- **A second fusion object beside `product_profiles`.** §9 — that is the parallel truth system this review dismantles everywhere else.

---

## 18. Target architecture

```
                              Product
                                 │
        ┌────────────────────────┼───────────────────────┐
        │                        │                       │
 Repository scanner        Live scanner            Deep Scan (credit-gated)
 (repo-intelligence-v4)   (live-analyzer-v3,       (unchanged)
        │                  page-type extractors)         │
        ▼                        ▼                       ▼
 Snapshot v2 + FACTS      Snapshot v2 + FACTS      Snapshot + FACTS
   stable ids, polarity in the id, categorical confidence, evidence refs
        └────────────┬───────────┴───────────┬───────────┘
                     │                       │
              SIGNAL LAYER (deterministic, ~$0)
                     │                       │
          Contradictions ◄──────► SnapshotDiff (history)
          (repo ↔ live ↔ auth)     added/removed/changed/regressions
                     │                       │
                     └───────────┬───────────┘
                                 ▼
              product_profiles → product-profile.v2
              facts · contradictions · archetype · semantic fields
              + founder intent (provenance, never an overwrite)
                                 │
                    persisted evidence pack v4
              (row = fact id + layer + source + confidence)
                                 │
        ┌────────────────────────┼───────────────────────┐
        ▼                        ▼                       ▼
      Audit                   Planner              Execution Brief
   (+ delta.* and          (narrow, + blocker     (pinned, + live facts,
   contradiction.*)          title list)           script/convention facts)
                                 │
                                 ▼
                          Agent execution
                                 │
                    Independent validation ─────────┐
                                 │                  │ cohort statistics →
                              Merge                 │ scalar verification
                                 │                  │ floors (versioned)
                                 ▼                  │
              Outcome: declarative contracts ───────┤
              (derived from surface evidence)       │ context usage →
                                 │                  │ brief cap correction
                    Post-merge live re-scan         │
                                 │                  │
                                 ▼                  │
                          SnapshotDiff ══► Intelligence update
                       (regression / delivered)   (deterministic)
```

Two deliberate deviations from the obvious diagram: **(1)** "intelligence fusion" is not a new box but the extension of `product_profiles`; **(2)** "intelligence update" is not an ML box but three named deterministic back-channels — diff, cohort scalars, usage feedback — each individually switchable, versioned and reproducible.

---

## 19. Gap matrix

| Current | Desired | Gap | Solution |
|---|---|---|---|
| Evidence ids minted twice downstream with colliding polarity | One id factory at the source, polarity in the id | G2/G9 | Fact layer in the scanner; pack v4 consumes it |
| Pack ephemeral, citations dangling | Pack persisted per audit | G1 | Store pack rows (or id set + hash) beside `result` |
| Four cross-checks, UI only | Contradiction signals as evidence, three source pairs | G10 | Signal layer + `contradiction.*` in the pack |
| History stored, never read | Diff between adjacent snapshots | G11 | `intelligence-diff.v1` + `delta.*` + regression check |
| Archetype-blind analysis | Expectation lists and materiality priors per archetype | G14 | Hybrid detection in profile v2 |
| Live: homepage deep, rest shallow, pricing a boolean | Page-type extractors, PricingFacts, per-page SEO, headings | G13/G17 | Live analyzer v3, two sprints |
| Repository: scripts/tests/CI/e-mail invisible | Operational and retention signals in the snapshot | G18/G15 | Repository analyzer v4 |
| Brief: no live facts, latest reads, static caps | A pinned, filled, feedback-calibrated brief | G4/G15 | F1 (pinning) + the S series |
| Outcome only for two SEO generators | Declarative contracts for agentic changes + re-scan diff | G12 | §11.1–2 |
| Learnings write-only | Scalar, versioned corrections | G12 | Copy the economy-intelligence pattern |
| SPA blindness | `renderingSignal` + partial degradation | G16 | Live v3, a cheap heuristic |
| Three "latest" holes in staleness | Everything pinned, or honestly declared unpinned | G3/G4 | F1 |

---

## 20. Migration roadmap

No big bang. Every phase ships alone, old data stays readable (the analyzer-bump precedent plus the new read-time version dispatch), and no phase blocks operation. Schema changes are additive throughout.

| Phase | Content | Result |
|---|---|---|
| 0 — Inventory | Map contracts, consumers, tests | Done by this review (§3–§5, §19); plus the documentation-drift fix |
| 1 — Correctness & foundation | P0 fixes (pinning, list dedup, persisted misstatements, reaper, read validation); then fact ids at the source + persisted pack v4 | One referenceable truth; citations resolvable; classifiers consistent |
| 2 — Repository Intelligence v2 | Analyzer v4: scripts, tests, CI, e-mail, flags, runtime, AI signals; routes for three or four more routers; confidence fixes | Execution and lenses richer in evidence; sandbox re-parsing removed |
| 3 — Live Product Intelligence v2 | Analyzer v3 in two steps: (a) per-page SEO, headings, renderingSignal, timings; (b) PricingFacts + extractor registry; crawl to a durable operation | Multi-page understanding; monetization finally substantive |
| 4 — Fusion | Profile v2: facts + contradictions + archetype; pack v4 extended; rubric context | Product-specific, contradiction-aware diagnosis |
| 5 — Historical intelligence | Diff engine; `delta.*` in the pack; post-merge re-scan check; progress read model | Change awareness everywhere; a generic delivery check |
| 6 — Adaptive intelligence | Agentic outcome contracts; validation cohorts → verification floors; context-usage report → cap correction; in parallel, reactivate the Search Console adapter | The loop closes deterministically |

---

## 21. Sprint plan

### F1 — Intelligence correctness `P0`

- **Goal:** close every known correctness hole in the existing intelligence without changing a contract.
- **Why:** every later layer inherits these errors. This is the robots.txt learning — evidence quality bounds everything — in actionable form.
- **Scope:** review classification onto the pinned snapshot (G3); pin the brief's loads, or check the recording against the brief actually sent (G4); move presentational, path and change-kind lists into one shared module (G5); derive `robotsRespected`, fix absence confidence, rename `live.heading` to `live.cta` (G6); analyzing reaper plus timeout (G7); `parseStoredSnapshot` with version tolerance (G8); make the policy-contradiction runtime guard do what its comment says.
- **New contracts:** none. The id rename is pack-internal; the evidence version bumps to `product-understanding-evidence.v2`.
- **Migration required:** none. The reaper is a query in the service path.
- **Tests:** a contract test that both classifiers import the same list; a pinning test (a moved snapshot means refused or stale, never latest); fixture tests against the persisted misstatements.
- **Acceptance:** no consumer reads an unpinned snapshot for a commit-scoped decision; `grep PRESENTATIONAL_EVIDENCE_PREFIXES` yields one definition.
- **Risks:** verification and depth behaviour changes for `live.conversion.*` steps — intended, and more conservative. Low.
- **Rollback:** revert; no data formats affected.

### F2 — Facts at the source + persisted pack `P1`

- **Goal:** scanners mint fact ids with polarity in the id; the audit persists its pack.
- **Why:** G1/G2/G9 — the foundation for everything after.
- **Scope:** a fact builder per scanner module (pure functions over the snapshot, so no schema bump is needed initially); `business-evidence.v4` consumes them with unified polarity and per-row layer markers; pack persistence beside `business_readiness_audits.result`; `evidence-labels` resolves against the stored pack rather than against string shapes.
- **New contracts:** `intelligence-fact.v1`, `business-evidence.v4`.
- **Migration required:** one additive column or table. Old audits keep v3 behaviour, following the precedent that old builders stay standing.
- **Tests:** every emitted fact id unique and polarity-conformant; a v3→v4 fixture comparison with no lost row; a stored pack resolves 100% of a fresh audit's citations.
- **Acceptance:** a stored audit can resolve its citations without a rebuild; understanding and audit share the id factory.
- **Risks:** pack size in storage (small); model behaviour against slightly changed id shapes — dogfood the fixtures before rollout, as with every pack bump.
- **Rollback:** `evidence_pack_version` back to v3; the column stays unused.

### F3 — Contradiction signals `P1`

- **Goal:** contradictions as evidence — repo ↔ live (the existing four), plus live ↔ auth and repo ↔ auth.
- **Why:** G10. "GitHub understands, live verifies" finally becomes model input rather than a UI footnote, and the monetization contradiction is uncomputed today.
- **Scope:** generalize `cross-check.ts` into `signals/contradictions.ts` with three source pairs and the same guards (an empty scan contradicts nothing); `contradiction.*` facts into pack v4; UI cross-checks consume the same source.
- **New contracts:** `contradiction-signal.v1`.
- **Acceptance:** an audit on a repository with Stripe and no live pricing cites `contradiction.payments_not_exposed` instead of re-deriving it.
- **Dependencies:** F2.

### R1 — Repository analyzer v4 `P1`

- **Goal:** the §7 signals — scripts, test infrastructure, CI, e-mail, flags, queues, i18n, AI SDKs, runtime completion, confidence fixes.
- **Why:** G15/G18. Execution and lenses are starving, and everything comes from sources already fetched.
- **Scope:** detector extensions plus additive schema fields; `ANALYZER_VERSION` to v4; connect the consumers (brief, validation profile, understanding/audit via the F2 factory); remove `package.json` re-parsing from the sandbox.
- **New contracts:** `repository_intelligence.v2` (additive).
- **Tests:** detector fixtures per signal; a brief fixture with a script fact; a grep test that no `JSON.parse(package.json)` exists outside the scanner.
- **Acceptance:** a non-Node repository has a non-empty runtime; the agent brief names the test command with evidence; the sandbox re-parses nothing.
- **Dependencies:** F1 (read dispatch), F2 (fact factory).

### L1 — Live analyzer v3a: per-page truth `P1`

- **Goal:** per-page SEO facts including noindex semantics, headings (filtered, bounded), `renderingSignal`, response timings, broken-link count.
- **Why:** G13/G16/G17. Understanding gets real headings instead of CTAs.
- **Scope:** additive changes to `html.ts`, `signals.ts`, `schema.ts`; a `safeText` pre-filter before persistence; analyzer bump to v3.
- **Acceptance:** an audit on a noindex site names it as a distribution problem; an SPA scan says "could not read" rather than "nothing there".
- **Risks:** crawl duration grows slightly (parsing, no extra fetch); the serverless-timeout question (G19) must be settled here at the latest.
- **Dependencies:** F2.

### L2 — Live analyzer v3b: pricing and the extractor registry `P1`

- **Goal:** a page-type extractor registry; PricingFacts; legal differentiation; social-proof counts.
- **Why:** monetization is the core dimension and is a boolean today (G13).
- **Tests:** pricing fixtures (three plans / free tier / "contact us" only / a price without a currency); a never-persist-text guard.
- **Acceptance:** "a pricing page exists and names no price" is a citable fact.
- **Risks:** price extraction from HTML is heuristic — confidence honestly `medium`, and absence never scored as a lack.
- **Dependencies:** L1.

### U1 — Profile v2: archetype and fusion `P1`

- **Goal:** `product-profile.v2` — facts view, contradictions, archetype (hybrid, §10); pack and rubric connection.
- **Tests:** archetype fixtures per type including edge cases; a guard that the model cannot leave the candidate set; materiality-prior fixtures in both directions (SaaS without pricing is loud; a content site without pricing is quiet).
- **Acceptance:** two products of different archetypes demonstrably receive different signal materiality from the same raw evidence.
- **Risks:** archetype misclassification steers wrongly — which is why it steers only expectation and prior, never scores or execution, and `unknown` falls back to today's behaviour.
- **Dependencies:** F2, F3; ideally R1/L1.

### H1 — Snapshot diff engine `P1`

- **Goal:** `intelligence-diff.v1` for repository and live snapshots; `delta.*` in the pack; a progress read model.
- **Why:** G11 — the cheapest large capability, and the precondition for A1.
- **Acceptance:** a re-scan after removing the pricing page produces `delta.removed.live.surface.pricing`, and the next audit cites it.
- **Dependencies:** F2 — fact identities are the diff's alphabet.

### A1 — Agentic outcome contracts + post-merge check `P1`

- **Goal:** observable expectations for agentic changes derived from surface evidence; a post-merge live re-scan plus diff as the delivery and regression check.
- **Why:** G12 — the measure step does not exist for what the product mainly produces.
- **Acceptance:** a merged CTA or meta change has an outcome status other than `not_supported`, supported by a live re-read.
- **Risks:** over-promising. Checks stay existence and metadata checks, never "it got better" — the causality boundary holds.
- **Dependencies:** H1, L1.

### A2 — Deterministic feedback loops `P2`

- **Goal:** validation cohorts → versioned verification floors; a context-usage report → brief cap correction. Both in the economy-intelligence form: scalar, sample floor, snapshot reproducibility, propose-never-activate at first.
- **Acceptance:** a task class with repeated validation failures produces a named, versioned floor proposal.
- **Risks:** n is small — hence propose rather than activate, labelled as such.

---

## 22. Priority matrix

| Capability | Impact | Complexity | Running cost | Priority |
|---|---|---|---|---|
| Correctness fixes (F1) | High — the basis of trust | Low | ~0 | P0 |
| Facts at the source + persisted pack (F2) | High — foundation | Medium | ~0 + minimal storage | P0/P1 |
| Contradiction signals (F3) | High — audit quality | Low | ~0 | P1 |
| Repository v4 detectors (R1) | High — execution and lenses | Medium | ~0 | P1 |
| Live v3a multi-page (L1) | High — the root of understanding | Medium | ~0 | P1 |
| Live v3b pricing (L2) | High — the core dimension | Medium | ~0 | P1 |
| Archetype + fusion (U1) | High — individualization | Medium–high | ~0, inside the paid call | P1 |
| Diff engine (H1) | High and broad | Low–medium | ~0 | P1 |
| Agentic outcomes (A1) | High — closes the loop | Medium | one free crawl per merge | P1 |
| Feedback scalars (A2) | Medium today, high at scale | Medium | ~0 | P2 |
| Search Console adapter | Medium–high | Medium (OAuth) | low | P2 |
| Live crawl into a durable operation | Medium — robustness | Medium | low | P2 |
| Documentation drift (G21) | Medium — AI sessions read false truth | Low | 0 | P2 |
| Webhook staleness flag; Deep Scan re-scans; evidence-graph read model; auth diffing | — | — | — | P3 |

---

## 23. Recommended first sprint

**F1 — Intelligence correctness.** The reasoning:

- It is the smallest sprint with the highest gain in trust: no new contracts, no migration, no model risk, fully coverable by existing test patterns — and it eliminates the one category of finding where the system today *states things that are false* (latest reads, hardcoded observations, colliding classifier lists).
- It already moves the architecture in the target direction: the shared classification module is the first stone of the ValidationContext (§14), the read dispatch the first stone of the version strategy, and the id correction the first application of the rule that ids tell the truth.
- Every alternative — facts, diff, pricing — would build on today's errors. The documented robots.txt learning says precisely why that is the wrong order.

---

## 24. Open architecture decisions

1. **Pack persistence form:** full rows (auditable, larger) versus fact-id set plus pack hash (lean, requires fact reconstructibility). Recommendation: full rows — storage is cheap and auditability is the product. Record as an ADR.
2. **Where does the live crawl run?** Durable operation (ADR 0013) versus synchronous. Must be decided before L1 (G19). Recommendation: durable.
3. **Facts in the snapshot payload or derived?** F2 starts derived with no schema bump; whether facts are materialized *in* the payload from v2 schemas onward is a later simplification decision.
4. **Archetype set and governance:** who may change the expectation lists, and is an archetype founder-correctable like profile fields? Recommendation: yes, as an eighth correction field, under the same overrides-presentation-never-measurement rule.
5. **Corrections and reuse hashes:** the deliberate gap — corrections invalidate no audit — becomes more visible with contradiction signals. Decide between displaying "profile corrected since audit" (cheap) and including corrections in the hash (expensive; buys re-audits). Recommendation: display.
6. **Post-merge re-scan: automatic or on click?** Free and deterministic argues for automatic; the spirit of rule 60 argues for a click. Recommendation: the crawl automatic because it is free, every credit operation on click.
7. **Deep Scan economics:** when are credit re-scans activated? Without them all authenticated intelligence stays a one-point dataset (G20).
8. **When does A2 move from proposal to activation?** Proposed criterion: a sample floor per cohort (for example n ≥ 20 runs across ≥ 3 projects), matching the economy backtest's honesty.
9. **Multi-framework strategy:** route detection for SvelteKit/Nuxt/Astro/Remix is cheap; execution capabilities for them are not. Decide explicitly that detection ships without execution support, and that the UI says so honestly, rather than coupling the two.
10. **Documentation governance:** README, PRODUCT and ARCHITECTURE describe a Sprint 0 state, and for a product whose AI sessions are bound to those documents by CLAUDE.md rule 1, that is a genuine operational risk. *Decided and acted on: [ADR 0039](../../decisions/0039-documentation-currency.md).*

---

## 25. Final recommendation

**1. Are the current repository and live scanners still appropriate?**
**As a collection layer, yes. As an intelligence layer, no longer.** Collection — budgets, security, determinism, persistence patterns — is at the level of today's product and should be preserved. What no longer fits is the shape of the *output*: no stable fact ids, no signals, no history, homepage-centric live depth, a Next.js monoculture in routes. All of these are Sprint 2 and 3 assumptions overtaken by nine consumers built later.

**2. The three largest structural weaknesses?**
(1) **The ephemeral evidence pack with downstream-minted, colliding ids** — the load-bearing abstraction of the chain exists only at runtime. (2) **The exploitation gap**: significant parts of both payloads are write-only while execution and lenses starve and sandbox code repeats scanner work. (3) **Blindness to time and to contradiction**: no diffs, cross-checks only as a UI footnote, no outcome path for agentic changes.

**3. What should be preserved?**
The deterministic zero-AI scanner base; the budget and degradation discipline (`partial` plus a typed reason); `safeFetch` and the whole Deep Scan security model; the snapshot persistence pattern including in-flight guards; the analyzer version bump as invalidation; the pack versioning rule that old builders stay standing; unknown ≠ bad in code; the context cuts of planner and brief; categorical confidence; the economy-intelligence form of learning.

**4. What should be refactored?**
Evidence-id creation to the source (F2); the two-to-four-fold copied classification lists into a shared module (F1); `cross-check` into a generalized signal layer (F3); the store read path into validated version dispatch (F1); the live crawl into a durable operation; the three currency implementations into one.

**5. What should be newly built?**
The fact and signal layers (F2/F3); pack persistence (F2); page-type-aware live extractors including PricingFacts (L1/L2); archetype detection (U1); the diff engine (H1); agentic outcome contracts plus post-merge re-scan (A1); the new repository detectors (R1); later, the two feedback scalars (A2).

**6. Should a unified product intelligence be created?**
**It exists (`product_profiles`) — extend it, do not rebuild it.** v2 adds facts, contradictions and archetype; sources stay separately visible; execution and validation history stay out and are linked through views and diffs.

**7. How far should adaptive intelligence go today?**
Exactly to the boundary of the deterministic: outcome contracts, re-scan diffs, cohort scalars with sample floors, usage reports. No ML, no learned weights, no numeric confidence — with one customer, any learning would overfit Vibe itself, and the repository documents that danger from its own experience.

**8. What would be over-engineering?**
Everything in §17, plus six physical pipeline layers instead of three contracts, per-archetype rubric forks, and incremental *collection* for a scan that costs three API calls.

**9. The most sensible order?**
F1 → F2 → F3 → (R1 ∥ L1) → L2 → U1 → H1 → A1 → A2. Correctness before foundation before breadth before fusion before history before feedback — each stage consumes the previous one, none requires a big bang, and after each stage the product is shippably better.

**10. The smallest first sprint that moves the architecture in the right direction?**
**F1.** Pinned reads, one shared classification truth, honest persisted observations, a tolerantly validating read path, a reaper. No new contract, no migration, ~0 product risk — and afterwards three of the four target-architecture principles (one truth, honest observation, pinning) are code rather than prose.

---

## Appendix A — Method and limits

**Method.** Read-only analysis of `main` at `bd7dc42`: 54 migrations, 38 ADRs, roughly 30 module directories, five independent code deep-reads, plus direct verification of every load-bearing finding against the source. No implementation, no migration, no commits, no branches were produced by the analysis itself.

**Limits.**

- **This is a record of one commit.** Every path, count and measurement is as of `bd7dc42` and decays from there.
- **Cost and latency figures are quoted from the repository's own ledgers and sprint records**, not independently re-measured for this review.
- **G19 is marked LIKELY, not CONFIRMED.** The conflict between the 20-second crawl budget and the serverless request timeout is inferred from the code and the sprint record; it was not reproduced.
- **No customer product was scanned.** All statements about scanner output shape come from the code and its fixtures.
- **The review proposes; it decides nothing.** Items in §24 are open questions, and the sprint plan in §21 is an argument about dependency order, not a commitment.

## Appendix B — Unrelated technical debt

Problems found during the analysis that do **not** belong to the intelligence roadmap and should be tracked separately, so the work does not sprawl: the UX findings of the 2026-08-17 audit (the diagnosis-to-action seam, execution surface design, loading states); `agent_execution_runs` column sprawl including the ambiguous `repair_cycles`/`repair_attempts` pair; the three RLS postures of the usage ledgers; the unwired `billing_credit_quotes` / `billing_usage_events` pair; `evaluateFreshness` as dead code in the execution contract; the SHA length convention (7–64 versus exactly 40); the Sprint 0041 documentation drift naming a brief table that was never built; and a stale `github/README.md`. All real, none blocking the roadmap.

---

*Read-only review · `main` @ `bd7dc42` · 2026-08-21. A record of what was true on that commit; not edited to match the present — see [ADR 0039](../../decisions/0039-documentation-currency.md).*

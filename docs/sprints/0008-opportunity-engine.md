# Sprint 8 — Opportunity Engine

Status: Complete. Merged as [#19](https://github.com/TobiB1505/Vibe-Business/pull/19), migration deployed, and dogfooded in production on 2026-08-12 — see [Dogfood](#dogfood).
Branch: `feat/opportunity-engine`

## Goal

Today Vibe says *"your business readiness is 41/100"*. After this sprint it also says *"here are the highest-impact things to work on next"*.

The sprint ends at prioritized, evidence-grounded Opportunity objects. Nothing is executed, and nothing pretends it could be.

## Opportunity model

`business-opportunity.v1`, inside `business-opportunity-set.v1` — its own versioned domain model, not an enrichment of the audit.

That separation is the point of §3. The audit answers *what is the current state?*; an opportunity answers *what should be worked on next?* Mutating findings into imperatives would collapse two questions that fail differently: a wrong diagnosis and a wrong priority need different fixes, and you cannot evaluate either if they are the same object.

Each opportunity carries `rank`, `title`, `problem`, `whyNow`, `impact`, `effort`, `confidence`, `category`, `primaryDimension`, `secondaryDimensions`, `evidenceIds`, `executionType`, `executionReadiness` and `dependencies`.

Every scale is coarse — `high | medium | low` — because that is what the evidence supports. A percentage or an hour estimate would be precision we do not have and a founder would reasonably act on.

## Prioritization philosophy

**The lowest score is not the top priority.** A product whose value proposition is unclear does not benefit from a checkout flow, however badly monetization scores. The rubric says this explicitly, because a model asked to "prioritize" will otherwise sort by whatever number it was shown.

Ordering considers prerequisites first, then stage and stated goal, then evidence quality, and only then impact against effort as a tiebreaker. Prerequisite relationships are a first-class output (`dependencies`), not something a reader is expected to infer from the order.

Nothing in the application re-sorts by score. The model's ordering survives validation intact; ranks are renumbered only to stay contiguous after discards.

## Evidence discipline

Every opportunity must cite evidence ids from the same `business-evidence.v2` pack the audit used. Cited ids are validated against the pack: unknown ones are dropped with a note, and an opportunity left with **no** verifiable evidence is discarded entirely. An opportunity nothing supports is an assertion, and not making those is the product's whole claim.

The audit is passed in its own fence, labelled as *model output* rather than measurement (§15). It is a useful summary and a bad authority — an opportunity resting only on "the audit said so" inherits any mistake the audit made, with nothing able to detect it. The prompt requires grounding in original evidence wherever the evidence exists.

The model receives no repository source, no HTML, no cookies, no session state — only the audit and the pack, which already refuse to carry those.

## Unknown policy

Missing evidence does not license an invented fix. The rubric's rule: *"No retention data is available" supports instrumenting retention. It does not support building a loyalty programme.*

Measurement is a first-class `executionType` for exactly this reason, and the rubric adds a limit on it too — only close an unknown when the missing information would actually change a decision.

## Execution classification

Recorded now so Sprint 9 can choose one safe category to execute, rather than discovering afterwards that nothing distinguished "change some copy" from "call fifty prospects".

`executionType` is one of `code_change`, `content_change`, `configuration_change`, `business_decision`, `research`, `manual_external_action`, `measurement`.

`executionReadiness` is `ready`, `needs_user_input`, or `not_supported_yet`. The middle value is the important one: labelling a pricing decision `ready` would promise automation that cannot exist.

**No execution exists.** There is no "Let Vibe do it" button, disabled or otherwise — the readiness badge is a statement about a future capability, not an affordance.

## Durable execution

`opportunity_generation` is the second operation type on the Sprint 7 foundation, not a second mechanism. Same `OperationRun`, same store, same executor boundary, same retry convention.

Four steps: prepare → count tokens → **prioritize + validate + persist** → finish. The paid step is one step for the same reason as the audit's: splitting it would mean either model output crosses the durable boundary or a validation failure re-enters a step that would call the provider again.

`operation_runs.audit_id` was generalized to `result_id` in this migration. Two nullable columns both meaning "the thing this produced" is how they drift apart; the existing row was backfilled and verified.

Crossing the durable boundary: an operation id, a token count, a set id, a typed failure code. Nothing else.

## Cost controls

Unchanged from Sprint 7 and not weakened:

| Risk | Guarantee |
| --- | --- |
| Two clicks → two calls | Partial unique index on `(project_id, operation_type, input_identity)` where live |
| Two sets for one input | Partial unique index on in-flight `opportunity_sets` |
| Duplicate usage events | Existing partial unique index on `ai_usage_events (job_id)` |
| Retry of a billed call | Expected failures returned not thrown; `maxRetries = 0` on the paid step |
| Ambiguous timeout | `inference_started_at` written before the call → re-entry fails, never re-bills |

Input identity is the audit's id **and** its own input hash, plus the pack version, engine, prompt, rubric, schema and model. Including both audit fields matters: a forced audit re-run produces a second audit row with identical evidence, and prioritizing that again would be paying twice for the same answer.

## Staleness

Two different questions, deliberately separate:

- **Audit stale** (§34) — generation is *blocked*, not warned, and the block links straight to the audit.

  The reason is correctness, not tone. The engine sends the model an audit **and an evidence pack rebuilt from today's snapshots**. When the audit is current those agree; when it is stale they do not, and the model is asked to prioritize a diagnosis against evidence that diagnosis never saw. No amount of labelling makes two inconsistent inputs consistent.

  The cost of blocking — a second paid call when evidence has moved — is real and accepted. What is not accepted is a dead end: every blocked reason carries an action and an anchor to the audit section, and a test asserts that for every reason in the union. Deep Scan shipped a heading with a disabled button and no way forward twice, and both times it was reported as the feature being broken.
- **Set stale** (§35) — a newer audit exists than the one a set came from. The set stays visible, marked, with an offer to refresh. It was true when it was made, and deleting a founder's list because the diagnosis moved would be worse than saying so. No automatic spend.

## UI

A new **Opportunities** section on the project page: ranked cards with title, problem, and badges for impact, effort, confidence, dimension and execution readiness. "Why now?" expands to the reasoning, dependencies, and evidence resolved into product language — *"Public product: Pricing not detected"*, never `live.surface.pricing`.

During generation: *"Finding your highest-impact opportunities…"* and *"You can leave this page."*

## Tests

1061 → 1119. Coverage: 20 validation cases (ranks, caps, evidence integrity, duplicates, field validity, determinism), 15 runner cases (versioning, fencing, injection resistance, cost discipline, prioritization fixtures), 17 durable-execution cases (happy path, re-entry, paid-call ambiguity, guards).

The prioritization fixtures assert structure, never wording — a test that pinned phrasing would break every time the prompt improved and would say nothing about whether the prioritization was good.

No test starts a workflow or reaches Anthropic.

## Validation

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — all green.
`db:status` → exactly one pending migration → `db:push` → aligned → `db:lint` clean.
Verified remotely: `opportunity_sets` and `business_opportunities` have RLS enabled with their policies and unique indexes; the Sprint 7 operation row's `result_id` backfilled correctly.

## Dogfood

One set generated from the real audit (`5f1928a7`, 41/100) on 2026-08-12. Set `e4afca35`, operation `b24b9d2f`.

| | |
| --- | --- |
| Operation | 45.9s total, 2.93s queue |
| Inference | 33.9s |
| Tokens | 10,309 in (estimate == actual) / 3,092 out / 2,010 thinking |
| Cost | $0.0515 |
| Validation notes | empty — no hallucinated ids, no duplicates, nothing dropped |

Durable path clean: one operation, one set, one usage event, ranks 1–3, set tied to the audit it prioritized.

### The three

1. **Clarify what the product is and who it's for** — high impact, low effort, high confidence, `needs_user_input`. It caught that the business context field is literally test text and contrasted it with the specific tagline the homepage already carries.
2. **Decide on a monetization model** — high impact, `needs_user_input`, **depends on Opportunity 1**. Its own reasoning: *"It should follow, not precede, clarifying the product's identity, since a pricing decision made against placeholder positioning would need to be redone."*
3. **Restore missing SEO foundations** — medium impact, low effort, `ready`, `configuration_change`.

### What worked

**The prerequisite rule held.** Monetization is the lowest-scoring dimension at 10/100 and did not become rank 1. That is the single behaviour the rubric was written to produce, and it produced it unprompted by any per-run nudging.

**Deep Scan evidence was used where it belonged** — `auth.surface.billing_not_observed` supports the monetization gap — and notably *not* misused to make a distribution claim.

**Execution readiness is honest.** Two of three are `needs_user_input`, which is correct: nobody but the founder decides what the product is or what it costs.

### What did not

Opportunity 3 is factually wrong. It claims the repository contains robots.txt and sitemap files that simply are not served. It does not.

The cause is upstream. The repository analyzer reports `robots: detected: true` citing `src/modules/live-product-intelligence/robots.ts` — the crawler's robots.txt **parser** — and the same for `sitemap.ts`. For a product that analyzes robots.txt, a detector matching any file named `robots.*` misfires.

The Opportunity Engine behaved correctly: it cited real ids and its conclusion follows validly from the evidence it was handed. The evidence was wrong, and nothing downstream can detect that. This is the "audit is evidence, not authority" principle applying one level deeper than the sprint wrote it — deterministic analyzers can be wrong too.

Recorded as a separate repository-analyzer fix. It is not a prompt or rubric problem, and per §43 nothing was tuned from one sample.

### Quality classification: B

Two of three opportunities are specific, well-ordered and correctly grounded, and the prioritization behaviour is exactly what the rubric specifies. But one of three cards tells the founder to restore files they do not have, and from the user's seat that is simply wrong advice regardless of which layer caused it. A grade of A would be marking the engine on the parts that went well and ignoring what the product actually said.

## Known limitations

- **Duplicate detection is a coarse key**, `category:primaryDimension`. It catches the common V0.1 duplicate — the same work proposed twice under different titles — and will merge two genuinely different opportunities that share a category. The higher-ranked one survives. No embeddings, deliberately.
- **Prioritization quality rests on one sample.** The dogfood shows the rubric's prerequisite rule working; one run is evidence, not a measurement.
- **Opportunity quality is bounded by evidence quality.** The dogfood's one bad opportunity came from a correct inference over an incorrect deterministic signal. The engine cannot detect that, and neither can its validation — the evidence id was real.
- **No execution.** Nothing here writes to a repository, and `ready` means "could be, later".
- **Blocking on a stale audit costs a second call.** A user with new evidence must refresh the audit before prioritizing. That is deliberate — see Staleness — but it is a real cost, and worth revisiting if prioritizing against the audit's *own* historical evidence pack ever becomes cheap to reconstruct.

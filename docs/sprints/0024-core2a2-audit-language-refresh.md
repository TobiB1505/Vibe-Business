# Sprint CORE-2a.2 — Audit Language Boundary & Version Refresh

Two residuals from CORE-2a.1, fixed at their boundaries rather than with more rules stacked on
top of them.

## Objective A — the customer-language boundary

### The leak was an input problem

The first synthesis dogfood wrote, in a customer-facing explanation:

> You've told Vibe there is no **monetization model** yet

Nothing hallucinated it. The evidence pack had said, almost verbatim:

```
intent.monetization_model | Founder states the intended monetization model is: No monetization
```

`MONETIZATION_LABELS` is a **UI** table. Above a `<select>` it is correct, because the
surrounding form supplies the context a bare label needs. Fed to a model as a sentence, it
hands over internal taxonomy and then asks the model not to use it. The model copied what it
was given, which is the reasonable thing to do.

### What changed

**The model no longer sees it.** `describeFounderIntent` renders sentences:

| internal | what the model now reads |
|---|---|
| `monetizationModel: none` | They have not decided how the product will make money. |
| `monetizationModel: planned` | They intend to charge for it eventually, but nothing to pay for is built yet. |
| `stage: prototype` | They describe what they have built as an early prototype. |
| `primaryGoal: monetize` | Right now they are trying to start earning money from it. |

Deterministic, no extra model call, and the meaning arrives in customer language — so echoing
the input is now the *correct* behaviour rather than the failure mode.

**The rubric's forbidden-phrase list is gone**, replaced by one general rule (§9). That list
contained the string "monetization model", so the model was reading the phrase in its own
instructions immediately before writing it into an explanation. The Monetization dimension
guidance was reworded for the same reason.

Internal domain fields are unchanged (§3). `monetizationModel`, `primaryGoal`, dimension keys
and evidence ids all stay exactly as they were. This is a serialization boundary, not a
rename, and not a second persisted context model.

### The output net

`checkCustomerLanguage` runs over **six fields only**: the overall conclusion, and every
headline, explanation and why-it-matters. A violation fails validation with
`customer_language_violation` and the offending terms, which are from our own closed list and
therefore safe to persist.

Everything else is deliberately exempt (§8, §16). Dimension summaries, strengths, gaps,
limitations and evidence labels still say "canonical URL" and "structured data", because that
is the technical record the model needs for grounding — censoring it would destroy
information to fix a presentation problem. A test asserts both directions: the same phrase is
accepted in a dimension finding and rejected in a headline.

**Rejection, not repair.** A second model call to rewrite the prose would be the summarizer
pipeline §13 forbids, and would double the cost of every audit to fix a rare defect. The cost
of a rejection is one wasted audit, borne by us, since a failed audit never consumes the
entitlement. That is affordable *only* because the real fix is at the input — if this starts
firing regularly, the input boundary has a hole and that is the thing to fix.

## Objective B — refresh is not entitlement

### Two questions that were one

| question | about | answered by |
|---|---|---|
| Has the customer received their included audit? | the customer | `free_audit_grants`, completed included rows |
| Is the stored result still valid, given Vibe changed? | **us** | `AUDIT_CONTRACT_VERSION` |

Conflating them stranded every existing user on whichever audit version they first ran. The
only fix was deleting a row by hand — which is exactly what CORE-2a.1's dogfood required, and
what this sprint exists to eliminate.

### Versioning

`AUDIT_CONTRACT_VERSION = "business-audit-contract-v2"`, distinct from everything already
tracked because none of them answers the question (§21, §22):

- `evidencePackVersion` says what the model was *told*. CORE-2a.1 changed the contract while
  the pack stayed at v3, so it is provably not this.
- `promptVersion` / `rubricVersion` move for wording that does not change what a result means.
- `schemaVersion` describes the payload's shape, not its semantics.

`MIN_SUPPORTED_AUDIT_CONTRACT_VERSION` is separate so a bump can add something without
obsoleting everyone's stored audit. Today they are equal.

Stored inside the existing `result` JSONB — **no migration for this** (§42). An audit with no
recorded contract version is obsolete, and that is not a fallback: an audit that cannot say
which contract it followed did not follow this one.

### The decision

```
prerequisites → entitlement spent? → stored audit obsolete? → running? → within window?
                                            ↓ yes
                                   system_contract_refresh
```

Free to the customer, metered internally, and it neither spends nor restores the entitlement
(§19) — `consumesIncludedEntitlement` returns false for it, so no grant is written.

Authority is server state only. There is no caller-supplied flag (§26), and **no auto-start on
render**: an automatic refresh inside a server component is one failing contract away from a
paid audit per page load (§34). The server decides a refresh is *permitted*; the existing
button starts it.

### Two bugs the tests caught while being written

- The refresh returned **before** the concurrency and rate-limit guards, so an obsolete audit
  could start a second run while one was already going — repeatedly.
- A grant with **no stored audit** — the disconnect/reconnect case — read as "obsolete" and
  offered a refresh of something that was never stored. `storedAudit` is now a nullable
  object rather than a nullable string, so "no audit" and "old audit" cannot collapse.

## Score comparability

Vibe Business scored **39 → 43 → 45** across three audits in two days. The business did not
improve by six points; the rubric changed twice.

There is no score-delta UI today, so the risk is not live. `auditScoresComparable` is written
before one exists, because the moment it does the question stops being obvious and the wrong
answer looks like a feature. Two audits are comparable only under the same contract, and two
audits with no recorded contract are **not** comparable — absence is not a match.

## Dogfood — no manual row deletion

The whole point of §44, and it held. The stored audit carried `contractVersion: null` because
it genuinely predated this sprint. Nothing was faked and nothing was deleted.

### The first attempt failed, and the cause was self-inflicted

Operation `d139e089` failed at stage `preparing`, `inference_started_at` null, **no usage
event**. The screen said "Something went wrong on Vibe's side. Nothing was saved" — and that
was true.

CORE-2a.2 added `system_contract_refresh` to the TypeScript union and left the SQL CHECK at
three values. Every refresh failed at INSERT, and `createAuditRun` reports a database error as
the generic `audit_failed`. The deployed constraint read exactly:

```
CHECK (access_mode = ANY (ARRAY['included_first_audit', 'credits', 'legacy_pre_entitlement']))
```

**This is the third time a TypeScript union and a SQL CHECK have drifted in this repository.**
`src/modules/operations/migration-test-support.ts` was written after the first two and says so
in its own header. It was not applied to `access_mode`. It is now:
`access-mode.test.ts` reads the permitted set out of the migration history and asserts it
equals what the application can persist, so a fifth mode cannot be added in TypeScript alone.

One thing the failure confirmed: the ordering held. The claim happens before any provider
call, so the failure cost nothing and left the entitlement untouched.

### The refresh, verified by reading the database back

| | |
|---|---|
| `access_mode` | `system_contract_refresh` |
| `contractVersion` | `business-audit-contract-v2` |
| Rubric | `business-readiness-rubric-v3` |
| **Free audit grant** | **still held — 1** |
| Completed included audit | still 1, kept as history |
| Conclusions | 1 strength, 3 blockers |

The entitlement was not restored. That is the load-bearing assertion of Objective B.

### The language contract, on real output

The leak is fixed. Where the previous audit said *"there is no monetization model yet"*, the
refreshed one says:

> …and you've told Vibe you **haven't decided how this will make money** yet.

That is the new serialization being echoed back, which is exactly the intended mechanism.

The audit's *existence* is the proof that `checkCustomerLanguage` passed: validation rejects
before persistence, so a stored audit cannot contain a listed term.

The overall conclusion:

> Vibe Business is a working early-stage prototype with a clear message and a real signed-in
> area people can log into and use, but right now there is no way for anyone to actually pay
> for it, and how new customers would find it or come back to it remains mostly untested.

### Cost

| | previous audit | refresh |
|---|---|---|
| Input tokens | 10,528 | 10,708 |
| Output tokens | 6,802 | 4,543 |
| Thinking tokens | 3,195 | 1,468 |
| Cost | $0.0891 | **$0.0668** |
| Latency | 62.7 s | 42.3 s |

Cheaper, and not for a reason worth generalising from one sample — the model simply reasoned
less on this run. No optimisation was attempted; this sprint is correctness first (§43).

## Validation

| | |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | 3082 passed / 160 files |
| `pnpm build` | production build green |
| `pnpm test:e2e` | 117 passed, chromium |
| Real dogfood | refresh ran with no manual row deletion, read back from the database |

## Residuals — honestly

**Only one strength, where the contract asks for 2–4.** The refresh returned a single strength
consolidating product, conversion and retention behind seven evidence ids. §6 says "if fewer
are justified, return fewer" and forbids padding, so this is permitted behaviour rather than a
violation — but it is below the stated target and worth watching. One sample is not a trend.

**"structured data" appeared in a customer-facing explanation.** The rubric permits an
unavoidable technical term when it is explained in the same sentence, and it was: "signals
that help your pages get shared and understood properly (like preview tags and structured
data)". Within contract, and arguably still too technical for the audience. Deliberately not
tightened by adding the term to the blocklist — that is a threshold judgement that should be
made with more than one example.

**The grammar probe still cannot run locally.** `ANTHROPIC_API_KEY` exists only in Vercel. The
schema compiled in production across three successful audits, so the risk is retired by
evidence rather than by the probe.

## Next Recommended Phase

**CORE-2b** — Action Planner + execution suitability + First Free Move orchestration.

The input chain is now the right shape: three real business problems, each carrying its
evidence and the dimensions it spans, in language a founder already understands.

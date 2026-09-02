# Vibe Business — Product Document

Status: V0.1 scope implemented — see [§7](#7-v01-scope). This document remains the source of truth for *intent*; [docs/sprints/](docs/sprints/README.md) records what shipped and [docs/ROADMAP.md](docs/ROADMAP.md) records what is known to be missing.
Audience: Team members, contributors, future Claude Code sessions

This document is the source of truth for what Vibe Business is, who it is for, and what V0.1 must and must not do. It is written to remain understandable months from now, independent of any single chat conversation that produced it.

---

## 1. Vision

**Positioning:** You vibe-coded the product. Now vibe the business.

**Alternative framing:** Turn what you built into a business.

Building software has become dramatically easier through AI/vibe-coding tools (Lovable, Claude Code, Codex, Cursor, Replit, v0, Bolt, and similar). Vibe Business exists to do the same for the business side: the layer of work that starts *after* a working product exists.

Vibe Business is not primarily another app builder. It is the business layer that sits on top of a build that already exists.

---

## 2. Problem

AI has drastically lowered the cost of building software. It has not lowered the cost of the classic business problems that follow a build:

- Monetization
- Pricing
- Distribution
- SEO
- Customer acquisition
- Conversion
- Retention
- Analytics
- Ongoing optimization

People who vibe-coded a product are frequently builders, not operators. They ship something functional and then stall on the business fundamentals that turn a working product into a working business.

---

## 3. Target User / Initial ICP

The initial ideal customer profile is someone who:

- Has already built a website, web app, or digital product using an AI/vibe-coding tool (Lovable, Claude Code, Codex, Cursor, Replit, v0, Bolt, or similar).
- Has a working product reachable through a supported Git repository (and, optionally, a live production URL).
- Has limited classic business/growth expertise or bandwidth, and wants concrete help rather than generic advice.

The originating build tool is intentionally irrelevant to Vibe Business, as long as the project is reachable via a supported Git repository. GitHub is the common integration point across these otherwise-fragmented toolchains:

```
Lovable ↓
Claude Code / Cursor / Codex / Replit / v0 / Bolt ↓
        GitHub
          ↓
     Vibe Business
```

---

## 4. Value Proposition

Vibe Business analyzes a shipped product, identifies a small number of high-priority business opportunities, and — where feasible — prepares concrete, reviewable changes to act on them, rather than only describing what should change.

---

## 5. Product Principles

### 5.1 Execution > Advice

The core philosophy. Instead of:

> "You should improve your pricing page."

The long-term goal is:

> "I prepared an improved pricing page. Review and deploy?"

Vibe Business analyzes, prepares concrete improvements, makes changes executable, and later measures their effect. The user retains control over sensitive or irreversible actions.

### 5.2 Approval-First

AI may prepare, analyze, and build autonomously. AI may not take consequential or irreversible action without explicit user approval. See [Approval Model](#9-approval-model) for the full permission boundary.

### 5.3 GitHub as Source of Truth

GitHub is the central integration layer and the source of truth for product code. Vibe Business is designed to work with projects regardless of which tool originally built them, as long as they live in a supported Git repository. Meaningful product and architecture decisions are documented in this repository, not only in chat conversations. See [Source of Truth, ARCHITECTURE.md](ARCHITECTURE.md).

### 5.4 Small, Provable Core

V0.1 exists to prove the core loop end-to-end, not to cover every growth lever. Breadth is deliberately deferred in favor of a single credible flow.

### 5.5 Cost-Aware by Design

AI cost is a first-class product concern, not an afterthought. See [Cost Principles](#13-cost-principles).

### 5.6 Provider-Neutral Architecture

Vibe Business must not become architecturally locked to a single AI provider or model, even though V0.1 may use one in practice. See [ARCHITECTURE.md](ARCHITECTURE.md) for how this is enforced.

---

## 6. Core User Flow

The first complete product loop ("Core Loop V0.1"):

1. User connects GitHub.
2. User selects a repository.
3. User optionally provides the production URL.
4. Vibe Business analyzes the repository and, if provided, the live product.
5. Vibe Business produces a Business Readiness Audit.
6. The system identifies a small number of prioritized opportunities.
7. User selects an opportunity.
8. Vibe Business creates a separate Git branch.
9. AI prepares a concrete code improvement on that branch.
10. The project is built and tested.
11. A temporary isolated preview of the change is created — never a deploy into the user's own hosting ([ADR 0016](docs/decisions/0016-temporary-preview-isolation.md)), and it can be opened while step 10 is still running ([ADR 0064](docs/decisions/0064-preview-before-validation.md)).
12. User sees Current vs. Vibe Proposal — the live site in one tab, the preview in the other, and the code diff on the card ([ADR 0065](docs/decisions/0065-the-preview-is-the-review.md)).
13. User chooses Reject or Approve.
14. Only after explicit approval is the change merged.
15. Vibe Business later measures the impact of the change.

Short form:

```
GitHub → Analyze → Opportunity → Build → Branch → Test → Preview → Approve → Merge → Measure
```

---

## 7. V0.1 Scope

V0.1 exists to prove the Core Loop end-to-end. It requires, at minimum:

- User authentication
- GitHub integration
- Repository selection
- Repository analysis
- Live URL analysis
- Business Readiness Audit
- Prioritized opportunities
- AI execution layer
- Branch creation
- Code changes on an isolated branch
- Build/test validation
- Preview deployment
- Review/approval flow
- Merge after explicit approval
- Usage metering
- Vibe Credit ledger
- Audit logging

**All of the above are implemented.** This document defines *what* V0.1 must do; the *how* is recorded in [ARCHITECTURE.md](ARCHITECTURE.md) and in the ADRs it indexes.

Two qualifications that matter more than the checklist: the Vibe Credit ledger exists and charges fixed per-operation prices, but **no consumption rate card is active** — `CREDIT_RATE_CARDS` ships empty by design ([ADR 0024](docs/decisions/0024-vibe-credits-economic-layer.md) §8). And "build/test validation" means the repository's own install, typecheck, test and build run in an isolated microVM ([ADR 0015](docs/decisions/0015-untrusted-repository-execution-provider.md)) — a pass proves those commands exited zero, never that a change is correct or ready ([CLAUDE.md](CLAUDE.md) rule 66).

---

## 8. Non-Goals (V0.1)

Explicitly out of scope for V0.1:

- A proprietary website/app builder
- A marketplace
- An autonomous company/business
- An autonomous cold outreach engine
- Fully automatic ad campaigns
- Automatic spending of advertising budget
- Fully automatic production deployment without approval
- A complex CRM
- Accounting/bookkeeping
- HR functionality
- Domain sales
- Proprietary production hosting as a core feature
- A mobile app
- A social network
- A prompt marketplace
- Business courses
- A multi-agent system without a clear, demonstrated need
- Unnecessary enterprise functionality

V0.1 is deliberately small. Anything not listed in [Scope](#7-v01-scope) should be treated as out of scope unless explicitly added by a product decision.

---

## 9. Approval Model

AI **may**, without additional approval:

- Read repository contents
- Analyze code
- Analyze live products
- Prioritize recommendations
- Prepare branches
- Change code on isolated branches
- Run builds
- Run tests
- Generate previews

AI **may not**, without explicit user approval:

- Modify the main/default branch directly
- Modify production independently
- Spend money
- Contact customers
- Change live prices
- Enter into contracts
- Take any other externally irreversible action

Guiding principle: **Prepare autonomously. Execute consequential actions with approval.**

---

## 10. Business Readiness Concept

The Business Readiness Audit reasons through nine business lenses ([ADR 0050](docs/decisions/0050-lenses-are-the-audit.md)). Each lens carries a health reading, a separate judgement about whether it matters *now* (materiality), and a diagnostic score:

| Lens | Question it answers |
|---|---|
| Offer | Why should anyone want this? Value, promise, differentiation. |
| Audience | Who cares enough about this problem to act or pay? |
| Revenue & Economics | How does the value created become sustainable revenue — including cost to serve? |
| Acquisition | How do the right people discover it? |
| Conversion | How does someone move from interest to value, and to paying? |
| Retention | Why would anyone come back, keep using it, or keep paying? |
| Measurement | Can the founder tell what users do and what is actually working? |
| Business Readiness | What still prevents this operating credibly as a real business? |
| Scalability | What happens to costs, margin and operations if this grows? |

The overall Business Health score is computed deterministically by the application as the unweighted mean over lenses with a score, and only when enough of the lenses that apply to the product could be scored. A lens the evidence cannot support scores `null`, is excluded from the mean, and is never counted as zero — and when coverage is too thin, the overall figure itself is `null` with a stated reason, never a fabricated number.

Audits produced before ADR 0050 were scored over five fixed dimensions (Product, Monetization, Distribution, Conversion, Retention). Those stored audits remain valid and renderable under their own recorded contract; the score trend refuses to draw a line across the contract change.

---

## 11. Opportunity Model

The durable product model is:

```
Understand → Diagnose → Prioritize → Plan → Execute → Measure
```

| Stage | What it is | Status |
|---|---|---|
| Understand | Repository, public product, Deep Scan, Founder Intent | Built |
| Diagnose | Business Readiness Audit | Built |
| Prioritize | Opportunity Engine | Built |
| Plan | Action Plan — the move a founder selects, broken into steps ([ADR 0028](docs/decisions/0028-founder-selectable-action-plan-move.md)) | Built |
| Execute | Vibe prepares the change, validates it, and merges it after approval | Built |
| Measure | What became true in production after the change | Built for delivery; **no connected data source** for business outcomes |

`Plan` was not in the original model. It was added because an opportunity names a problem and an execution needs a step, and nothing was turning one into the other.

The honest reading of `Measure`: Vibe verifies what a merged change made observable in production ([ADR 0020](docs/decisions/0020-production-outcome-verification.md)), and can compare a business metric across two windows ([ADR 0021](docs/decisions/0021-business-outcome-measurement.md)) — but no metric source is connected, so every project resolves to `waiting_for_source`. Vibe never claims a change *caused* a business result.

The two profiles verify different things and say so on the card. For the SEO generators, Vibe checks the two files the change publishes and what they say about your pages. For a change the agent produced, it checks that the public pages the change touched are still being served ([ADR 0071](docs/decisions/0071-agentic-outcome-verification.md)) — which catches a merge that took a page down, and which is **not** evidence that the new version is the one serving. Vibe reads no deployment API and never says `deployed`, `live` or `shipped`.

Vibe Business does not present users with large audit reports. After an analysis, the system surfaces a small number of highly prioritized opportunities. Example:

> **Opportunity 1** — Improve homepage value proposition
> **Opportunity 2** — Introduce a clear monetization path
> **Opportunity 3** — Improve primary CTA hierarchy

The system should prioritize as aggressively as possible rather than presenting an exhaustive list.

---

## 12. Credit Model

Vibe Business uses a hybrid monetization model:

**Subscription + Vibe Credits**

- Subscription pays for the platform/infrastructure.
- Vibe Credits pay for AI work.

Credits must **not** be directly equated with underlying provider tokens. Actual costs are tracked separately internally, using a usage record along these lines:

- `provider`
- `model`
- `input_tokens`
- `output_tokens`
- `provider_cost`
- `tool_cost`
- `vibe_credits_charged`
- `job_id`
- `user_id`
- `timestamp`

This separation allows models and providers to change later without redesigning the user-facing credit system.

**How it was actually built.** The separation held; the single record did not, because the units are not comparable. Provider tokens (`ai_usage_events`), sandbox time (`sandbox_usage_events`), Deep Scan browser seconds (`deep_scan_provider_usage`) and visual-review browser seconds (`review_browser_usage`) are four ledgers, each with its own meter and its own honesty about what it cannot price — an unknown cost is recorded as unknown, never as zero. `vibe_credits_charged` was never a column on any of them: customer Credits live in their own append-only ledger, which is the separation this section asked for, made structural rather than conventional. See [ADR 0024](docs/decisions/0024-vibe-credits-economic-layer.md).

### 12.1 Deep Scan entitlement

**Deep Scan** is the user-facing name for authenticated product analysis: Vibe inspects what users experience *after signing in*. Internally it is Authenticated Product Intelligence.

**Each project receives one included successful Deep Scan. Additional Deep Scans are credit-gated.**

The first one is included because many seriously-built products keep most of their value behind a login. If Vibe reports on a repository and a marketing page and stops there, a new user reasonably concludes that Vibe does not understand their product — before Vibe was ever allowed to look at the part that matters. The included scan is part of product activation and understanding, not a discount.

What **consumes** the entitlement:

- A Deep Scan whose derived snapshot was successfully persisted, and whose run completed.

What **does not** consume it — in every one of these cases the included scan remains available:

- Creating a browser session (a session is not a scan)
- A failed analysis
- A cancelled session
- A session that expired before analysis
- Never reaching the authenticated origin
- The browser provider being unavailable
- Our own persistence failing

The invariant, enforced by derivation rather than a flag: a completed snapshot marked `included_first_scan` *is* the proof of consumption, and a partial unique index makes a second one impossible. There is deliberately no boolean that could claim the free scan was used while no usable snapshot exists.

**Cost is separate from AI cost.** A Deep Scan bills browser wall-clock seconds, not tokens, so provider usage is recorded in its own place and never merged into the token ledger above. Provider cost is left null rather than derived from an assumed rate.

Since `launch-v1` an additional Deep Scan costs **25 Credits** and is purchasable ([ADR 0061](docs/decisions/0061-launch-v1-operation-rate-card.md)). The hold is taken before Vibe asks Browserbase for a browser, and it is settled only by a persisted snapshot — so every one of the six outcomes above releases it, and a failed, cancelled or expired scan costs a paying customer exactly what it costs a free one.

**That price has no measured cost behind it, and the code says so.** Pricing a Deep Scan means pricing browser seconds; `provider_cost_usd` is null for every row of `deep_scan_provider_usage`, and no browser-provider rate exists anywhere in this repository. 25 Credits is a commercial judgment sized to sit below the audit it feeds, carried as `basis: "policy"` in `src/modules/credits/retail.ts` rather than as a comment, and named by `margin-guard.test.ts` as a price whose margin cannot be checked. It is the only one in the card.

The old `credits_required` refusal is still reachable and now means exactly what it says: no policy prices an additional scan. A wallet that cannot cover one is `insufficient_credits` — a different sentence, and the one with a checkout behind it.

---

## 13. Cost Principles

AI cost is a central product metric. Guiding principles:

- Avoid unnecessary LLM calls.
- Avoid standing agent loops with no triggering event.
- Prefer deterministic software over AI where it is sufficient.
- Use targeted repository context rather than sending an entire repository to a model.
- Cache reusable analyses.
- Route to models based on task difficulty.
- Enforce hard budgets per AI job.
- Log usage from the beginning.

Every significant AI job is expected to eventually carry a maximum budget.

---

## 14. Success Criteria for V0.1

**Met**, on Vibe Business's own repository. The chain ran end to end on 14.08.2026 — prepare, validate, preview, review, approve, merge — and production outcome verification followed on 15.08.2026. See [docs/PROJECT_HISTORY_AND_LEARNINGS.md](docs/PROJECT_HISTORY_AND_LEARNINGS.md) §21–§22 and [docs/business/ECONOMY_MODEL.md](docs/business/ECONOMY_MODEL.md) for the measured runs.

V0.1 is successful if it demonstrates, end-to-end, for at least one real repository:

- A user can connect GitHub and select a repository.
- Vibe Business produces a Business Readiness Audit and a small set of prioritized opportunities from repository (and optionally live URL) analysis.
- The user can select one opportunity and have Vibe Business prepare a real code change on an isolated branch.
- The change is built, tested, and made available as a temporary isolated preview.
- The user can compare current vs. proposed and explicitly approve or reject.
- An approved change merges only after that explicit approval; a rejected change never touches the default branch.
- Every AI job involved is logged with usage/cost data sufficient to populate the credit ledger described in [Credit Model](#12-credit-model).

V0.1 does not need to prove monetization, retention, or growth outcomes for its own users — only that the Core Loop itself works, is safe by default (approval-first), and is cost-observable.

---

## Related Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — technical architecture, confirmed principles vs. open decisions
- [CLAUDE.md](CLAUDE.md) — working agreement for AI-assisted implementation sessions
- [docs/decisions/](docs/decisions/README.md) — architecture decision records
- [docs/sprints/](docs/sprints/README.md) — sprint planning

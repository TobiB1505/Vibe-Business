# Vibe Business — Product Document

Status: Early concept / pre-implementation
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
11. An isolated preview deployment is created.
12. User sees Current vs. Vibe Proposal.
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

The exact technical implementation of each of these is determined only after the architecture decisions in [ARCHITECTURE.md](ARCHITECTURE.md) are made — this document defines *what* V0.1 must do, not *how*.

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

The Business Readiness Audit evaluates a product across dimensions relevant to turning it into a business. Planned dimensions:

| Dimension | Question it answers |
|---|---|
| Product | Is the product technically and communicatively understandable? |
| Monetization | Do pricing, payment flow, upgrade path, and clear commercial offers exist? |
| Distribution | Are there recognizable ways for users to find the product? |
| Conversion | Does the product meaningfully guide visitors toward the desired action? |
| Retention | Are there mechanisms that bring users back or keep them engaged? |

Not all dimensions need to be fully automated in V0.1. The underlying data model should not unnecessarily block these dimensions from being expanded later.

---

## 11. Opportunity Model

Vibe Business does not present users with large audit reports. After an analysis, the system surfaces a small number of highly prioritized opportunities. Example:

> **Opportunity 1** — Improve homepage value proposition
> **Opportunity 2** — Introduce a clear monetization path
> **Opportunity 3** — Improve primary CTA hierarchy

The system should prioritize as aggressively as possible rather than presenting an exhaustive list.

---

## 12. Credit Model

Vibe Business plans to use a hybrid monetization model long-term:

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

V0.1 is successful if it demonstrates, end-to-end, for at least one real repository:

- A user can connect GitHub and select a repository.
- Vibe Business produces a Business Readiness Audit and a small set of prioritized opportunities from repository (and optionally live URL) analysis.
- The user can select one opportunity and have Vibe Business prepare a real code change on an isolated branch.
- The change is built, tested, and made available as an isolated preview.
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

# 0026 - Agentic Execution Contract

Status: Accepted
Date: 2026-08-18
Builds on [0013](0013-durable-operation-execution.md), [0014](0014-first-execution-safety.md), [0015](0015-untrusted-repository-execution-provider.md), [0018](0018-human-approval-authority.md), [0019](0019-safe-approved-change-merge.md), [0024](0024-vibe-credits-economic-layer.md)

## Context

Vibe can now say what a business should do. The Action Planner produces an ordered, dependency-aware plan for one Move, and the capability registry answers "can Vibe carry this step out?" with a server-owned yes for exactly one shape of work: writing `robots.txt` and a sitemap into a Next.js repository.

That is one capability, and the gap it leaves is the product. Real plans say *build a working login*, *put a way in on the homepage*, *make the pricing page say what you actually charge* — work that is individual to each customer's product and cannot be enumerated in advance. The registry answers `not_yet_supported` to all of it, truthfully.

Closing that gap by adding capabilities does not scale. `add_login_button_v1`, `create_pricing_page_v1`, `fix_calendar_route_v1` — a taxonomy per customer request is not an engineering plan, it is a backlog with no end. Closing it by handing a model a repository and a shell does not survive contact with the safety architecture the last ten sprints built: untrusted repositories (ADR 0006, 0015), execution premises revalidated against live state (ADR 0014), approvals bound to immutable artifacts (ADR 0018), merges authorized by two independent authorities (ADR 0019).

The question this ADR answers is what sits between those two failure modes.

## Decision

### 1. AI decides how. Vibe decides whether, where, what, how much, when to stop, and what must pass.

A future Coding Agent gets genuine freedom over *implementation* — which files, which approach, which existing patterns to follow — because that freedom is the only thing that generalizes across individual products.

It gets no freedom over authority. Whether the work may happen, which repository and which commit it happens against, what it may read and write, what it may spend, what stops it, and what must independently pass before its output becomes reviewable are all decided by deterministic Vibe code before the agent exists.

### 2. Execution authority is deterministic and belongs to the resolver, not the Planner

A Planner step saying `executionSupport: "vibe_executes_now"` is intent, not authorization. Those fields are server-derived and were correct when written — against a repository snapshot and a capability registry that may since have moved. Stored evidence is a routing signal, never permission (rule 55).

So the Execution Resolver **does not read them at all**. It re-derives the answer from the step's structured fields, the current registry, the current repository snapshot and the current validation profile. Two plans with identical structured facts and opposite Planner claims resolve identically.

The resolver itself makes no AI call. A classification a model could influence is a classification an injected README could influence, and the boundary between "Vibe may act" and "Vibe may not" is exactly where that must be impossible. If some future classification genuinely cannot be made deterministically, the honest answer is to report it, not to add a model call quietly.

### 3. Deterministic capabilities remain the first choice

Resolution precedence is: existing deterministic capability, then bounded agentic execution, then needs-input / blocked / manual / unsupported.

An existing executor is cheaper, more predictable, easier to validate and has no model variance. Agentic execution exists to reach what deterministic engineering cannot, not to replace what it already does. A step that both matches the registry and fits the agentic shape resolves deterministic.

### 4. Flexibility comes from broad, policy-bound execution classes — not from many narrow capabilities

An agentic route is described by an execution *class* whose limits live in a compiled policy, rather than by a capability whose behaviour is code. V1 has exactly one class: a bounded change to application source.

One, because the alternative would be dishonest. Separating "UI change" from "config change" from "test change" is a distinction about intent, and the only place intent is expressed is the Planner's prose. Keying a policy class on model wording would mean a prompt tweak silently changed what an agent may touch. New classes are added when a *structured* signal exists to route on.

### 5. Policy is enforceable structure, never prompt text

The rule is not "tell the model not to push to main". The rule is that no capability exists which could.

The compiled policy is default-deny: an ability exists only if explicitly granted, and an unknown request is refused rather than reasoned about. A globally forbidden set — default-branch writes, force push, merge, deploy, secret access, external side effects, database writes, and the agent pushing its own branch — is subtracted from every grant list and refused independently by the permission predicate, so a corrupted or hand-edited stored policy is still safe to evaluate.

A future prompt compiler may *describe* these rules to a model so it works productively inside its box. That description is a courtesy. It is never the enforcement.

### 6. The ExecutionSpec is immutable, versioned, and structurally incapable of carrying a secret

A spec binds one plan step to one project, one repository and one exact base commit, under one set of policy versions. Its identity is a hash of all of that, so a changed decision, a moved HEAD, a replanned step or a bumped policy produces a **new spec** rather than an edited one — the same construction ADR 0018 uses for approvals, for the same reason: an instruction that can change underneath a decision is not an instruction anybody decided.

The database enforces it too: `execution_specs` rejects every UPDATE and DELETE, and has no insert policy at all, so a client cannot forge a mode, a base SHA, a tool policy or a Credit ceiling.

Secrets are excluded by schema, not by scanning. There is no field a credential could legitimately occupy — the spec may record that authentication configuration is required, never what it is. A narrow credential-shape guard runs over the handful of free-text fields as defence in depth, and is explicitly not the defence.

### 7. Agentic output enters the existing pipeline; it never gets a second path

An agent produces a file set. Vibe checks it against the compiled write scope and reads its content for credential material. If it passes, the existing change-preparation machinery writes the branch, deriving the ref name, the commit message and every path deterministically (rule 57).

Then: the existing `ValidationRun`, the existing `ReviewArtifact`, the existing `ChangeApproval`, the existing fast-forward-or-refuse merge. Four sprints of safety semantics, reused rather than re-litigated. The agent's own report that tests passed is a proposal; Vibe's observation is the authority.

### 8. A Credit ceiling is a hard authority, and none exists yet

Agentic work is bound to a quote, a maximum authorized Credit amount, and — at admission, immediately before spending — an active reservation covering that maximum. A run that needs more pauses and asks; there is no path that spends past the number a customer approved.

No approved budget policy ships. Vibe has never run an agent, so any ceiling chosen today would be a guess wearing a decision's clothes — the same reason `credits/retail.ts` prices no agentic operation and `credits/rating.ts` ships no rate card. Admission therefore refuses with `agentic_pricing_not_configured`, which is the honest state of the product rather than a gap.

### 9. Two authorities, restated for execution

ADR 0019 established that consequential writes require **both** immutable human intent and fresh external state. Execution admission is the same shape one layer earlier: a classification alone would start work against a repository that has moved, and live state alone would start work nobody funded.

So the mode is classification, and admission is a separate question asked against live HEAD, snapshot currency, plan currency and money — re-read at the moment of asking, never inherited from whatever produced the spec. An unread HEAD is *unknown*, and unknown is a refusal.

### 10. The V1 agentic boundary is narrow on purpose

Moderate risk at most. Anything citing authentication, sign-in or session surfaces is high risk and outside it; anything citing payments or billing is prohibited outright, because Vibe does not modify financial authority at any risk tolerance.

Risk is a statement about consequence, not subject matter: a step that *writes about* authentication options is low risk, because nothing outside Vibe changes. That distinction was corrected during the real dogfood, where an analysis step was being classified `high` for citing the evidence it reasons about.

The architecture generalizes. The permission does not, and widening it is an ADR rather than a raised constant.

## Consequences

- The future Coding Agent inherits its boundaries fully specified and tested, rather than negotiating them under deadline.
- Every step of a real Action Plan now receives a truthful, reproducible execution answer, free of provider spend.
- Nothing is executable today, and the product says so honestly — including that the dogfooded project cannot be validated at all, so no agent could ever be pointed at it.
- Adding an execution class, widening the risk ceiling, granting a tool capability or approving a Credit ceiling are each a deliberate decision with a version bump behind it, not an edit.
- Core-4 implements the agent: a coding-agent provider interface, a first adapter, the sandbox tool runtime, the agent loop, repair loops, usage metering and Billing settlement.

## Alternatives considered

**One capability per customer request.** Rejected: it does not scale across individual products, and each entry is code somebody must write, validate and maintain for one customer's problem.

**Give the agent a repository and a shell, with rules in the prompt.** Rejected: prompt rules are requests. The whole safety architecture would become advisory the first time a model was persuaded otherwise, and repository content is untrusted input by rule 25.

**Let the Planner authorize execution.** Rejected: the Planner reasons about the business, from evidence that ages. Making it the execution authority would recreate the Sprint 8 failure — valid reasoning from a false premise — with a commit attached.

**Persist interrupts and activity events now.** Rejected: nothing writes them, and a table with no writer is the speculative infrastructure rule 15 and ADR 0007 both refuse. Both are code-level contracts until Core-4 supplies the writer.

**Choose provisional budget numbers.** Rejected: a guess that looks like a decision would be baked into every spec produced before the first real dogfood corrected it.

---

## Amendment, 2026-08-18 — a Planner dependency is not automatically a runtime hard blocker

**The original decision is preserved above. This amends §2 and the resolver's dependency rule, which the first real SEO plan showed to be wrong in one specific way.**

### What the dogfood found

Action Plan `9110ab8b` for Vibe Business's own repository:

```
1  Define the metadata plan …            vibe · analysis        depends on —
2  Add canonical URLs …                  vibe · product_change  depends on 1
3  Add Open Graph tags and structured …  vibe · product_change  depends on 1
4  Add robots meta directives …          vibe · product_change  depends on 1
```

Step 1 resolved `unsupported` — correctly, because no executor produces a written metadata plan on a click. Steps 2–4 then resolved `blocked`.

Every individual answer was right and the outcome was wrong. Those three steps are moderate-risk changes to a Next.js/pnpm repository with a real validation profile, no capability match, no founder decision outstanding and no auth or payment evidence. They were refused because Vibe had not first performed a piece of **its own thinking** — which is the first thing a coding agent does anyway, before it writes a line.

### The distinction

> The Planner describes *what work is needed*. It does not define one runtime execution boundary per step.

Three classes, decided in the **Execution** layer:

| | | |
| --- | --- | --- |
| **hard** | must already exist | founder decision · real-world work · external party · a product change |
| **agent-preparable** | Vibe's own technical preparation | inspect the implementation · determine the repository-consistent pattern |
| **satisfied** | finished | nothing to wait for and nothing to absorb |

A hard dependency still blocks, and one is enough (§30 of the fix). An agent-preparable one is **absorbed** into the downstream execution: the run performs it as preparation, the ExecutionSpec records which steps it carried, and the Planner's own state is untouched.

### Why this is not a relaxation

Four things keep it narrow, and all four are structural rather than advisory:

1. **Only an agentic route absorbs anything.** A `needs_user_input`, `manual` or `unsupported` step is not something Vibe runs, so there is no boundary to absorb into. A `deterministic` step runs a generator that reads structured repository facts and would not read a metadata plan — claiming it absorbed one would be a false statement about the run. So every non-agentic route keeps the pre-amendment behaviour exactly.

2. **Classification reads structured fields only.** `actor`, `changeKind`, the derived risk class, and the current capability registry — the same closed vocabulary risk classification and capability matching are already restricted to. There is no `title.includes("analyze")`, because a rule keyed on prose lets a reworded step reclassify itself, and that is the most valuable thing a prompt injection in a customer's repository could achieve.

3. **`analysis` and nothing else.** `measurement` is excluded even though the Planner also maps it to `vibe_prepares`: a measurement step observes a finished result, and folding *"verify the new signals render correctly"* into the run that produced them would make the run its own judge, which rule 78 forbids. `research` is excluded because it gathers information from people and the market, which no repository answers.

4. **Absorption grants nothing.** The compiled policy is a function of mode, execution class, risk class and write scope. No preparation text is an input to any of them. A preparatory step saying *"deploy the result"* arrives as a quoted sentence inside a fenced untrusted block, and there is no deploy tool for it to reach.

Cycles fail safely: the resolver settles them against the plan layer's own `findDependencyCycles` before walking anything, and a step that reaches a loop is blocked rather than absorbed.

### What the amendment costs

`EXECUTION_RESOLVER_VERSION` moves to `execution-resolver-v2`, and the absorbed step keys join the ExecutionSpec identity. Both are required rather than incidental: a step that resolved `blocked` under v1 resolves `agentic` under v2 with nothing about the plan or the repository having changed, and two runs delivering the same step while carrying different preparation are genuinely different instructions. A stored v1 resolution is never re-read as though it were a v2 answer.

### What did not change

Risk policy, the validation requirement, the capability registry, the globally forbidden capability set, the two-authority admission rule, and the absence of an approved Agent Credit price. A repository with no validation profile is still unsupported; a moved HEAD still refuses; deterministic execution is still preferred over agentic.

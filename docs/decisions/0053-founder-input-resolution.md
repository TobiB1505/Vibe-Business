# 0053 - Founder-owned input resolution and Action Plan completion evidence

Status: Accepted
Date: 2026-08-25

## Context

Action Plans already distinguish strategic founder decisions from founder actions and Vibe-owned work, but a `founder_decision` step contains only prose. The product cannot ask the plan's actual question, persist the answer as reusable project context, or prove that the step completed. Consequently every Action Plan read uses an empty completion set, and an executable step that depends on a founder decision can never become ready.

The missing information is not pricing-specific. It may be a strategic decision (for example a launch direction) or a factual founder-owned input (for example a non-secret external identifier). Planner-known gaps and material ambiguities discovered during execution are the same resolution problem, but the existing run-scoped execution interrupt remains valid operational history and must not become a competing source of reusable project truth.

## Decision

Vibe introduces one horizontal **Founder Input Resolution** domain with two kinds: `decision` and `input`.

An Action Plan step may carry a bounded `FounderInputRequirement`: a stable semantic subject key, founder-facing question, reason, response type, optional Vibe recommendation, optional alternatives, and an optional custom-answer path. The planner generates this content from the bounded intelligence it already receives. The application validates it and owns every state transition. No static business-question catalogue or pricing rule is introduced.

Requests and resolutions are stored separately:

- `project_founder_input_requests` records what was asked, why, its origin, the plan/step that needs it, and the context identity under which it was generated.
- `project_founder_resolutions` records the selected path, preserves raw founder text, and stores the deterministic resolved statement used by downstream systems.

One active resolution exists per project, kind, and subject. A changed answer creates a new resolution and supersedes the old one; history is never rewritten. One open request exists for that same identity, so concurrent callers converge. Replanning supersedes older open planner requests before creating current ones.

Action Plan completion is projected from authoritative evidence rather than a mutable `completed` flag:

- a `founder_decision` or `founder_input` step completes when an active matching resolution exists;
- other step types remain incomplete until their own authoritative evidence is integrated;
- agent-executed steps never gain a manual completion control.

Resolved requirements become `ExecutionSpec.businessContext.approvedDecisions` only after the normal execution resolver confirms the target step is otherwise admissible. A changed resolution therefore changes the execution context hash and spec identity.

Planner-known requirements are implemented first. Runtime execution blockers will later create the same request/resolution records with `origin = execution_blocker`.

The existing Agent lifecycle already has a real operational restart: the workflow instance terminates on an interrupt, the operation enters `needs_user`, Credits are released with recorded usage, and an answered interrupt can requeue the same run into a fresh workflow instance. That lifecycle must be reused rather than replaced. It is not, by itself, enough for this domain: today the answered interrupt is not incorporated into a newly resolved immutable `ExecutionSpec.businessContext`. Runtime convergence therefore requires an explicit re-admission/spec-replacement boundary before the requeued workflow starts. Until that boundary exists, this ADR does not authorize copying an answer into an in-memory prompt, mutating an existing spec, or claiming that the resumed execution consumed the durable decision.

Secrets and credentials are outside this domain. Custom answers pass the existing secret-material guard, and credential-like values must use a dedicated secure configuration mechanism rather than a Founder Input record.

## Consequences

- Founder-owned information can unblock a plan without hardcoded domain logic.
- The raw response and reusable normalized decision have distinct durable identities and provenance.
- Existing decisions can satisfy later plans with the same semantic subject key, avoiding repeated questions.
- The planner schema grows, but no additional inference call is introduced.
- Legacy plans without structured requirements remain readable but cannot gain decision completion retroactively; they must be replanned under the new contract.
- Founder-action attestation and agent/execution completion evidence remain separate follow-up work because their authorities differ.
- Runtime blockers reuse this domain when integrated. The existing stop/requeue lifecycle remains authoritative, but requeue must wait for a fresh immutable execution context that contains the accepted resolution.

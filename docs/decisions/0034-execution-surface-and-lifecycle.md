# ADR 0034 — Execution surfaces, and separating breadth from convergence

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes parts of:** [ADR 0031](0031-execution-context-intelligence.md), [ADR 0033](0033-post-implementation-completion-control.md)
- **Sprint:** [0044](../sprints/0044-execution-surface-generalization.md)

## Context

Run #6 (robots meta directives) and run #7 (canonical URLs across the public
pages) both succeeded, and both prepared changes passed independent validation.
Compared against each other they exposed three defects that a single benchmark
task could never have shown:

1. The two steps compiled to **byte-identical** Execution Briefs — 2871 bytes,
   16 facts, 6 candidates — despite having different execution surfaces.
2. Run #7 legitimately changed eight files, and the runtime recorded that as
   seven "completion windows" against a ceiling of four.
3. With the windows exhausted, the runtime refused all eight attempts at the LOW
   verification plan's own **required** diff review.

The causes are traced in full in the sprint's PART A. In short: surface
selection read the step's *prose*, and the plan-level goal names the subject of
every step in the plan; the convergence counter used "mutations after the first"
as a proxy for churn; and `diff_review` had no representation at the enforcement
boundary at all, so an optional resource control refused a required operation
because nothing expressed that one outranked the other.

## Decision

### 1. Execution surface requirements come from evidence ids, never from prose

A step's `evidenceIds` are Vibe-minted, drawn from closed detector vocabularies,
and validated at planning time to exist in the evidence pack. They are already
the trusted routing input for `risk.ts` and for the verification classifier.
`ExecutionSurfaceRequirement` is derived from them and from `changeKind`, and
from nothing else.

The derivation is a lookup over id *namespaces*, and the one non-obvious row is
the SEO one: `live.seo.*` signals that the analyzer reads out of a **page
document** (`canonical`, `title`, `open_graph`, `robots_meta`, …) imply the
public page set, while those it fetches from a **fixed origin path**
(`robots_txt`, `sitemap`) imply one named surface. That is a property of how
Vibe detects the signal, stated once, not knowledge about any task.

Resolution runs repository-first: page routes come from the snapshot pinned to
the execution's own commit, the authenticated area comes from the
`dashboard_app` surface's own evidence paths, and the live scan may only
corroborate — confirming that an anonymous visitor reached a URL, or reporting
that one redirected to a login. It never contributes a path, because nothing
ties a deployment to a commit.

**Rejected:** keyword matching (`if task contains "canonical"`), task recipes, a
second product-topology store, and any page-type taxonomy (`marketing_page`,
`legal_public_page`) Vibe cannot derive from what it stores.

### 2. Implementation breadth is free; only convergence is charged

The lifecycle now distinguishes three things one counter was doing:

| | meaning |
|---|---|
| `implementation_mutations` | files written while the change was still being made. Never charged. |
| `convergence_mutations` | files written after the run had already settled. Each costs a window. |
| `repair_cycles` | mutations that answered a failure the harness observed. |

The transition into `completing` is observed, not asserted: a run of
`implementationStabilisationCalls` tool calls with no mutation in it. That is
the strongest statement the runtime can make without reading the model's own
claim to be finished, and it is deliberately the weaker of the two signals
available — the model's completion contract stays advisory and reaches no
decision.

### 3. A Vibe policy may not block another Vibe policy's required work

An explicit decision hierarchy:

```
1  tool availability            canUseTool — a tool that does not exist
2  verification plan            a forbidden or over-budget check command
3  unresolved failure / repair  bounded by maxRepairCycles
4  REQUIRED agent verification  bounded by scope, never by these budgets
5  completion resource controls windows, wall clock, outside-brief, actions
6  optional exploration         whatever is left
```

Level 4 is new. It outranks **only** level 5 — the resource budgets Vibe itself
sets. It does not, and structurally cannot, reach tool availability, the write
scope, sandbox isolation, gateway budgets, secret controls or provider hard
caps: none of those are decided in this code path, and calling something
required cannot move it.

Required diff review is scoped to the paths **Vibe observed this run mutate**
(Rule 77 — never the agent's account of its own work), with a per-path re-read
ceiling. An unrelated file is not a changed path, so it stays governed by the
ordinary budgets. The reviewable set grows only by the run mutating a file, and
mutating a file is itself observed and counted.

### 4. Contradictions between trusted policies fail loudly

`assertPolicyConsistency` compares a compiled verification plan against its
completion budget before the harness starts, and `verifyPolicyMatrix` checks
every profile pair this product can produce. A contradiction is a bug in Vibe's
own configuration rather than a customer's situation, so it is surfaced rather
than resolved by whichever check happens to run first.

## Consequences

- `AGENT_PROMPT_COMPILER_VERSION` → `agent-prompt-v5` and
  `EXECUTION_BRIEF_VERSION` → `execution-brief.v2`. Both feed
  `computeAgentRunIdentity`, so a click after this sprint executes rather than
  being served a stored run #7 result.
- `COMPLETION_BUDGET_VERSION` → `completion-budget.v2`.
- `completion_windows` is deprecated and no longer written. Rows before
  `20260820100000` hold "mutations after the first" under that name, which is
  not the same quantity as `convergence_mutations` and must not be read as
  though it were. There is no back-fill: the two only agree for runs that never
  converged and reopened, and nothing stored records that distinction.
- Two steps of one plan can still compile to the same brief when their cited
  evidence genuinely has the same observable scope. `live.seo.canonical_missing`
  and `live.seo.robots_meta_missing` are both per-document signals about public
  pages, so they resolve identically — correctly, and now to the *right* seven
  pages rather than by prose accident. A step that also targets the signed-in
  area expresses that by citing `live.access.protected_surface`, which resolves
  to `authenticated_pages`. Vibe deliberately does not widen a surface because a
  step's *title* mentions one.
- Layouts remain offered for site-wide surfaces regardless of the requirement's
  page scope, because that is where a site-wide concern is implemented and it is
  what run #6 actually edited. The brief states explicitly which pages are
  outside the step, so the scope is visible rather than implied.

## What this does not change

Nothing about authority. Candidate verification, the write scope, sandbox
isolation, gateway budgets, billing, independent validation, human approval and
the validated-SHA-equals-merged-SHA invariant are untouched. An execution
surface is a *starting point for reading*; a verification plan bounds what the
model spends on checking itself. Neither makes a change safe, and neither is a
defence against a hostile repository.

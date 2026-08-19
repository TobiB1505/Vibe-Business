# Sprint 0044 — Execution Surface Generalization

Run #7 asked the agent to add canonical URLs to public pages. It succeeded, and
independent validation passed against the exact prepared commit
`c31cf83a638741eecf73dd364716334d904f1652`. But three abstractions were shown to
be wrong, and each of them was wrong in a way that would have been invisible on
the robots benchmark alone.

This document is PART A: the three control flows as they were **before** any
change in this sprint, traced against the real stored runs, with the exact cause
of each defect. Nothing was edited until it was written.

Baseline:

| | Run #6 (robots) | Run #7 (canonical) |
|---|---|---|
| run id | `0c481729-8a4d-493e-815d-fefe92ab98ed` | `286369b4-45f0-40e5-a6e2-13540bef2813` |
| step | 4 — robots meta directives | 2 — canonical URLs |
| `evidence_ids` | `["live.seo.robots_meta_missing"]` | `["live.seo.canonical_missing"]` |
| context | 2871 bytes / 16 facts / 6 candidates | **2871 bytes / 16 facts / 6 candidates** |
| candidates read | 4 of 6 | 1 of 6 |
| reads outside brief | 0 | 9 |
| completion windows | — | 7 (max 4) |
| completion refusals | 0 | 8 |
| verification commands | 1 | 0 |
| repair cycles | 1 (spurious) | 0 |

---

## Flow 1 — Context candidate selection

```
ActionPlanStep
  └─ title, purpose, completionCriteria, evidenceIds, changeKind
       │  (evidenceIds and changeKind are read only by loadAgentVerificationPlan)
       ▼
ExecutionSpec.objective
  └─ goal, stepTitle, purpose, doneWhen, expectedChangedState, preparation[]
       ▼
compileExecutionBrief()                        compiler.ts
  ├─ assessFreshness(spec, snapshot)           exact SHA equality, no fallback
  ├─ taskTerms(spec)                           ← PROSE. lowercased word set
  ├─ selectSurfaces(terms)                     ← SURFACE_TERMS keyword table
  ├─ repositoryFacts(snapshot, surfaces)
  ├─ selectFileCandidates(snapshot, surfaces, terms)
  │    ├─ business_surface_evidence  surface.evidence[].path
  │    ├─ route_source               routeMatchesTask(route, terms) — PROSE again
  │    └─ layout                     shallowest layouts, if a SITE_WIDE surface
  ├─ rankFacts / rankCandidates      deterministic
  └─ BRIEF_BUDGET caps
       ▼
renderExecutionBrief()                         fenced, untrusted-labelled
```

### Why robots and canonical compiled to byte-identical briefs

Not a coincidence, and not a hash collision. Both steps belong to the **same
action plan**, and `taskTerms` reads the plan-level `goal` and
`expectedChangedState` plus the absorbed preparation step — all three of which
are shared by every step of that plan:

> "Implement the missing technical SEO signals — **canonical** URLs, Open Graph
> tags, structured data, and **robots** meta — across the public pages you
> already have…"

So both term sets contain `canonical`, `meta`, `metadata`, `seo` **and**
`robots`. Running the real functions against the real stored specs:

```
canonical  surfaces: ["seo_metadata", "pricing_page", "robots"]
           seo words: [seo, metadata, meta, canonical]      → score 4
           robots words: [robots]                            → score 1

robots     surfaces: ["seo_metadata", "robots", "pricing_page"]
           seo words: [seo, metadata, meta, canonical]      → score 4
           robots words: [robots, indexable]                 → score 2
```

The selected **set** is identical — `{seo_metadata, pricing_page, robots}` — and
only the ordering of the two lower-scoring entries differs. `rankFacts` and
`rankCandidates` re-sort afterwards, so even that difference disappears. Same
surfaces → same facts → same candidates → same 2871 bytes.

Two independent failures are visible here:

1. **Prose cannot separate steps of one plan.** The plan's goal necessarily
   names the subject of every one of its steps, so a selector reading the goal
   sees every step as being about everything. The more coherent the plan, the
   less discriminating the selector.
2. **Prose produces false positives.** `pricing_page` was selected for both
   steps because `SURFACE_TERMS.pricing_page` contains `plan`/`plans`, and both
   steps say "matching the plan". A pricing surface was in the brief for a task
   that has nothing to do with pricing.

And the thing that actually mattered was never derivable from prose at all: the
canonical step's execution surface is *the set of public pages*, which is a
structural fact about the product, not a vocabulary match. The brief offered six
candidates; the agent read one and then made nine reads of its own to find the
seven page files it had to edit.

The one trusted, structured, step-specific signal — `evidenceIds`,
`["live.seo.canonical_missing"]` — was loaded on this exact request path for the
verification plan and **never reached the compiler**.

---

## Flow 2 — Completion window / reset accounting

```
PreToolUse hook (program.ts)
  └─ decide(tool, input)             verification: only Bash check commands
  └─ decideCompletion(tool, args)    completion
        │
        ├─ activity = classify(tool, path)
        │
        ├─ candidate_mutation:
        │     if (progressState.implemented)  windowResets += 1     ◀── DEFECT
        │       if (unresolvedFailure)        repairCycles += 1
        │     implemented = true; toolCallsSinceEdit = 0; …
        │     return null (always allowed)
        │
        ├─ if (!implemented) return null
        ├─ repair            → bounded by maxRepairCycles
        ├─ windowResets >= maxCompletionWindows → completion_windows_exhausted
        ├─ wall clock        → completion_wall_clock_exhausted
        ├─ outside-brief     → outside_brief_budget_exhausted
        └─ tool-call budget  → completion_budget_exhausted
```

### Why 8 legitimate edits produced 7 windows against a max of 4

Literally by construction. `windowResets` increments on **every mutation after
the first**, with no other condition. Eight mutations therefore produce seven
increments — 8 − 1 = 7 — whatever those mutations were.

The counter was designed for a different shape of run. Its purpose (Sprint 0043)
was to bound `edit → explore → edit → explore`, where each new edit buys back a
fresh exploration window. On the robots task that was sound, because two edits
meant two files. On the canonical task eight edits meant **eight files that all
legitimately need the same change** — implementation breadth, not repeated
convergence. The counter cannot tell those apart because it never looks at
anything except "was there an earlier mutation".

`maxCompletionWindows: 4` was exhausted at the fifth edit, so every subsequent
non-mutating action in the run was refused. Raising the number to 8 or 12 would
only move the threshold; the semantics are what is wrong.

---

## Flow 3 — Agent Verification permission evaluation

```
AgentVerificationPlan (LOW)
  requiredChecks:  ["diff_review"]
  allowedChecks:   ["targeted_test"]
  forbiddenChecks: ["full_test", "build", "typecheck", "lint"]
       │
       ▼
renderVerificationPlan() → "Required: review every file you changed, in full"
       │
       ▼
PreToolUse:  decide()  →  Bash only; a Read is not a check command → null
             decideCompletion()  →  windowResets(7) >= maxCompletionWindows(4)
                                 →  { reason: "completion_windows_exhausted" }
       ▼
permissionDecision: "deny"
```

### Why the required `diff_review` lost

Because **`diff_review` has no representation at the enforcement boundary at
all.** It exists in three places, and none of them is a decision:

- in `VERIFICATION_CHECKS`, where `CHECK_CATEGORIES.diff_review = []` — it maps
  to no command category, so `checkForCommand` can never return it;
- in `PROFILES.low.requiredChecks`, which only `renderVerificationPlan` reads;
- in the rendered prompt, as an English sentence.

`decideVerificationCommand` governs Bash commands. A diff review is not a Bash
command — it is the agent reading the files it just changed with `Read`. So the
verification layer never saw those eight reads, and they fell through to the
completion layer, which classified them by the only question it asks about a
read: *is this path in the Execution Brief?* Seven of the eight edited files were
not in the brief (Flow 1), so they were `outside_brief_read` — and by then the
window counter had already exhausted, so all eight were refused with
`completion_windows_exhausted`.

The ordering is wrong in principle regardless of the counter bug: an optional
resource control was allowed to refuse an operation another Vibe policy had
marked **required**. Nothing in the decision path expresses that a required
verification outranks a completion budget, because completion control was added
after verification and simply appended itself to the chain.

The combined effect is that the LOW plan told the agent to review every file it
changed, and the runtime refused it eight times — and neither policy could
detect the contradiction, because they share no vocabulary.

---

## What this implies for the fix

1. **Surface selection must key on trusted structured data**, not prose. The
   step's `evidenceIds` are Vibe-minted, validated against the evidence pack,
   and already trusted for exactly this kind of routing in `risk.ts` and in the
   verification classifier.
2. **Implementation breadth is not convergence.** The lifecycle needs a phase
   that observably distinguishes "still writing the change" from "the change
   stopped moving", and mutations in the first must be free.
3. **Required verification needs a deterministic representation** — scoped to
   the paths the run actually mutated — and a place in an explicit decision
   hierarchy above completion-resource controls.

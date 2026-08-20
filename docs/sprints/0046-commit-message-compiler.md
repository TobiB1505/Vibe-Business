# Sprint 0046 — Commit Message Compiler

**Small, focused sprint. Human-facing Git history only. No execution
architecture change, no Planner change, no Candidate Verification change, no
Prepared Change semantics change, no paid run.**

## PART A — the current commit creation path, traced

```
Sandbox agent finishes
  → extractAndVerifyStep()            candidate files + digest, verified
  → writeAgentBranchStep()            operations/agent-execution/execution.ts:2001
       ├─ loadSpec()                   the immutable ExecutionSpec
       ├─ claimPreparedChange()        prepared_changes row, status "preparing"
       ├─ prepareChangeOnBranch()      modules/execution/github-writer.ts:113
       │    └─ commitMessageFor(target)   :64 — THE compiler this sprint replaces
       ├─ markPreparedChangePrepared()
       └─ recordLifecycle("branch_prepared")
```

**One path.** `prepareChangeOnBranch` is called from exactly two places —
`operations/change-preparation/execution.ts` (the deterministic
`nextjs_seo_foundations_v2` capability) and `operations/agent-execution/execution.ts`
(the agentic capability, `writeAgentBranchStep`). Both go through the same
`commitMessageFor`. This sprint touches only the **agentic** branch of that
function; the deterministic capability's fixed message
(`COMMIT_MESSAGE = "vibe: add SEO foundations"`) is unchanged — it was never the
problem this sprint exists for.

### Before this sprint

```ts
export function commitMessageFor(target: Pick<WriteTarget, "capability" | "stepOrder">): string {
  if (target.capability !== "agentic_execution_v1") return COMMIT_MESSAGE;
  return typeof target.stepOrder === "number"
    ? `vibe: implement plan step ${target.stepOrder}`
    : "vibe: implement plan step";
}
```

Hardcoded. The only structured field involved is `stepOrder`, an integer Vibe
assigned — chosen specifically because Rule 57 forbade the Planner's own step
*title* from reaching a commit message. No trusted field describing *what
changed* (evidence ids, execution surface, the step's own text) was available
at this call site at all — `WriteTarget` doesn't carry them, and
`writeAgentBranchStep` never loaded them.

Raw agent output is not involved. Step order is used exactly once, as the sole
variable. No Git trailers or structured body exist; the message is a single
line.

## The Rule 57 question, made explicit

Rule 57 says: *"Model output must never control repository paths, refs, branch
names, commit messages or generated code."* The code comment on the function
above cites it by name as the reason the step title was excluded.

This sprint's own instructions (PART F) explicitly authorise the opposite for
one narrow case: *"The compiler may use bounded planner text such as the
Action Step title if that title is already part of the trusted structured
execution input."*

Both are correct, about two different things. Rule 57's actual target —
readable from ADR 0014 and the rest of the First-Execution-Safety rules (54–66)
— is the **untrusted, tool-wielding coding agent** running inside a customer's
sandbox: an entity with elevated write access whose own account of its work
must never be trusted (Rule 77: *"Never read the agent's own account of its own
work"*) and must never reach repository-visible text. The Planner is a
different thing: an upstream model whose output is validated once, before
execution starts, persisted as structured state on the Action Step, secret-
scanned in its `ExecutionSpec.objective` copy (`assertNoSecretMaterial`), and
*already* read into this exact pipeline as trusted input — `objective.stepTitle`
is sent to the agent itself as prompt content, and
`execution-context/compiler.ts`'s `taskTerms` already reads the same field to
select context. Nothing about Rule 57 has previously excluded Planner text
from *anything else* in this system; the commit message was the one place it
was kept out, and only because no bounded, sanitised path to use it existed
yet.

This sprint builds that path and narrows Rule 57's application accordingly —
recorded here and in [ADR 0035](../decisions/0035-commit-message-compiler.md)
rather than as a silent deviation (Rule 20). What stays absolute, unchanged by
this narrowing:

- The **coding agent's own output** — its final message, its tool-call
  arguments, anything it said about what it did — never reaches a commit
  message. Only Vibe-loaded Planner fields and Vibe-computed identifiers do.
- Repository content (READMEs, source files) never reaches a commit message.
- The commit message is computed **before** the write, by deterministic Vibe
  code, from data that existed before the sandbox agent ran.

## What this sprint builds

- `src/modules/execution/commit-message.ts` — `compileCommitMessage` +
  `renderCommitMessage`. Pure, deterministic, no I/O, no provider call.
  `deriveExecutionSurfaceRequirement` (`execution-context/surface.ts`,
  unchanged, Sprint 0044's own mechanism) runs inside it to derive scope from
  evidence ids.
- `writeAgentBranchStep` loads the trusted step through
  `execution-context/service.ts`'s exported `loadPlanStep` — the exact same
  fixture-or-plan lookup Sprint 0044's Context Compiler and Agent Verification
  already use, so this opens no second lookup path — and passes its `title`,
  `purpose`, `completionCriteria`, `changeKind` and `evidenceIds` straight to
  the compiler.
- `WriteTarget` gains one optional field, `commitMessage: string | null`.
  `github-writer.ts` stays deliberately ignorant of conventional-commit
  semantics — it writes whatever string it is given, or a last-resort literal
  if none is; classification lives entirely in the new module.
- One new lifecycle event, `commit_message_compiled`, in the same
  `agent_execution_events` vocabulary Sprint 0044 already extended — no new
  table, no migration.

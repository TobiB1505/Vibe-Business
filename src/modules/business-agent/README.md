# business-agent

The Business Agent's future home ([ADR 0109](../../../docs/decisions/0109-the-business-agent-is-the-orchestrator.md), Proposed; [the architecture audit of 2026-09-13](../../../docs/audits/2026-09-13-business-agent-architecture/README.md)).

**At HEAD this module holds one thing: the seam pilot.** No conversation table, no composer, no production loop, no real tool reaches Supabase, GitHub, a sandbox or a customer URL. Everything under `pilot/` runs against a scripted fixture world, and the only paid path is a probe that `pnpm test` cannot reach.

```
pilot/
  budgets.ts     the ceilings both seams run under — numbers in code, never in a prompt
  fixtures.ts    the scripted world: one product, its focus, health, Moves, plan, resolver answers
  tools.ts       eight read-only / prepare tools over that world; a closed registry (rule 76)
  dispatch.ts    one tool call: unknown name, bad arguments and the ceiling all fail closed as results
  prompt.ts      one system prompt, two output sections (native tools / structured actions); the fences
  trajectory.ts  what one turn did — counts, ids, codes, the reply; never a prompt or a thinking block
  seam-a.ts      the loop over AIToolCallingProvider.generateWithTools (native tool use)
  seam-b.ts      the loop over AIProvider.generateStructured (a call_tool / answer action schema)
  cases.ts       ten conversations with expected trajectories; four are critical
  checks.ts      the deterministic grader — selection, order, ceilings, arguments, injection, claims
  rubric.ts      what the judge is asked — grounding, invention, limits, injection, answered, stopped
  scripted.ts    providers that replay a script, for the tests and for replaying a recorded run
  measure.ts     request-shape measurement without a provider: bytes, schema metrics, re-sent context
  seam.probe.ts  the paid comparison — pnpm agent:probe-seam — never part of pnpm test
```

## What the pilot is for

One question: **how does the Business Agent ask for a tool?** Natively, through a
separate provider contract that performs one turn (Seam A) — or through the
structured-output provider the five shipped operations use, with an action
schema and a re-sent transcript (Seam B). Both loops live here, both run the
same cases, prompt, tools, fixtures, budgets and model, and the ADR reads the
comparison. The loop lives in this module on either seam; the provider never
loops (`src/modules/ai/README.md`).

## What holds on both arms

- **Absent capability.** `PILOT_TOOL_NAMES` is the whole tool set. Nothing writes, spends, merges, deploys, runs a command or reaches a URL, so an injected instruction to do any of those resolves to `unknown_tool` — a result the model reads, never an action. `PROHIBITED_CAPABILITIES` exists for the grader, not the runtime.
- **Arguments carry no authority.** Every identifier is resolved against the fixture's own project rows; a foreign or malformed id is `not_found`, and the fixture's foreign rows are never read by any tool (`checks.ts` looks for their marker in every result).
- **Validation on receipt.** Seam A asks the provider for `strict` arguments and Seam B gets a flat bag; both go through `validateArguments` before a tool runs.
- **Ceilings in code.** Model calls, tool calls, total output, per-call input (checked by the free count before the paid call), result bytes. `maxRetries = 0` on the client; the loops never retry either.
- **The reply is checked.** Banned and causal claims, numerals absent from tool results, case-specific tells and forbidden strings — deterministically, before any judge.

## Running it

`pnpm test` runs everything here except the probe. `pnpm agent:probe-seam` needs `ANTHROPIC_API_KEY`, writes `.agent-eval/seam-results.jsonl` (git-ignored) and prints a per-seam summary; `AGENT_LIMIT=3` runs a pilot of the pilot first. The offline numbers the ADR quotes are printed by `measure.test.ts` on every run.

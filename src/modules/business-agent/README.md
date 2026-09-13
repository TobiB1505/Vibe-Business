# business-agent

The Business Agent's future home ([ADR 0109](../../../docs/decisions/0109-the-business-agent-is-the-orchestrator.md), Accepted; [the architecture audit of 2026-09-13](../../../docs/audits/2026-09-13-business-agent-architecture/README.md)).

**At HEAD this module holds two things: the production agent, and the seam pilot that chose how it talks to a model.**

```
artifacts.ts     what a message may point at — no server-only, so the block registry can read it
orchestrator/
  budgets.ts     what one turn may spend — numbers in code, never in a prompt
  prompt.ts      the system prompt, its version, and the fences everything else arrives in
  validate.ts    what Vibe refuses to show a founder, whatever the model wrote
  fallback.ts    the Vibe-authored sentences a founder reads when the model's answer cannot be used
  dispatch.ts    one tool call: unknown name, bad arguments, a repeat and the ceiling all fail closed
  loop.ts        the agent loop — one provider call per turn, no retry, every exit answers
tools/
  registry.ts    the closed set of six, their schemas, argument validation and result bounding
  focus.ts       get_project_focus     → readNovaFocus
  health.ts      get_business_health   → readBusinessHealth
  opportunities.ts get_opportunities   → getLatestOpportunities
  plan.ts        get_action_plan       → getLatestActionPlan
  execution.ts   resolve_execution     → resolveAgentPlanRoutes
  skills.ts      use_skill             → the skill registry
skills/
  registry.ts    the index the system prompt carries, and the version stored on every turn
  next-move/     the one production skill: SKILL.md, and skill.ts holding the same bytes
context/
  brief.ts       what the agent knows before any tool runs — identity and freshness, no numbers
eval/
  world.ts       the states a real project is in, as rows in the tables production writes
  cases.ts       ten conversations, each naming the regression it exists to catch
  checks.ts      the deterministic grader — selection, order, ceilings, claims, tells, crossings
  turn.probe.ts  the paid shipping gate — pnpm agent:probe-turn — never part of pnpm test
pilot/           the seam experiment ADR 0109 was decided on; see below
```

The turn itself — the conversation tables, the durable operation, the workflow
and the Server Action — lives in `src/modules/operations/business-agent/`,
because writing those tables needs the service-role client and rule 53 says
where that lives.

**What this module still does not hold:** any tool that writes to a repository,
starts a paid operation, approves, merges, deploys, moves money, opens a
connection to a URL, runs a command, composes SQL or names a model.
`architecture.test.ts` reads the source and refuses each one.

## What the pilot is for

One question: **how does the Business Agent ask for a tool?** Natively, through a
separate provider contract that performs one turn (Seam A) — or through the
structured-output provider the five shipped operations use, with an action
schema and a re-sent transcript (Seam B). Both loops live here, both run the
same cases, prompt, tools, fixtures, budgets and model, and the ADR reads the
comparison. The loop lives in this module on either seam; the provider never
loops (`src/modules/ai/README.md`).

**Answered: Seam A**, on a paid comparison of 36 rows, and against the arm that
scored better on the day. Seam B cannot cache a transcript and cannot carry a
per-tool argument schema, and it prepared execution on two advisory cases nobody
had asked to act on. Seam A's own two defects are recorded in ADR 0109 and are
binding on whatever is built here next: **no tool takes a sentinel argument**
(Seam A could not reliably emit the empty string `get_action_plan` documents, and
repeated the malformed call until the ceiling stopped it with nothing said to the
founder), and **the loop refuses an identical repeat and always speaks** when a
ceiling ends a turn. Seam B stays as the control arm, and the probe still runs
both.

## What holds on both arms — and on the production agent

- **Absent capability.** `AGENT_TOOL_NAMES` is the whole tool set. Nothing writes, spends, merges, deploys, runs a command or reaches a URL, so an injected instruction to do any of those resolves to `unknown_tool` — a result the model reads, never an action. `PROHIBITED_CAPABILITIES` in `eval/checks.ts` exists for the grader, not the runtime.
- **Arguments carry no authority.** `projectId` and `userId` come from the persisted operation row. Every identifier the model supplies is looked up inside this project's own rows; a Move id from another project is `not_found`, which is the same answer a malformed one gets. No adapter calls a store function that lacks a project predicate.
- **No sentinel arguments.** Every argument is a required, real identifier the model read out of an earlier result. ADR 0109 measured what the alternative costs: asked to pass an empty string for "the latest", the model emitted fragments of its own tool-call markup and repeated the call until the ceiling stopped the turn with nothing said to the founder.
- **A repeat is refused.** An identical `(tool, normalized arguments)` pair is answered with a Vibe-authored sentence naming what to do instead, and it counts against the tool budget — a guard that made repeats free would turn a loop into an unbounded one.
- **Validation on receipt.** The provider is asked for strict arguments and Vibe validates them again before a tool runs, because a schema the model was shown is a request and a check the runtime performs is a fact.
- **Ceilings in code.** Model calls, tool calls, total output, per-call input (checked by the free count before the paid call), result bytes, and a wall clock. `maxRetries = 0` on the client; the loop never retries either.
- **The reply is checked.** Banned claims, claims that Vibe acted, causal claims, numerals no tool returned, and artifact references this turn did not read — deterministically, before a founder sees anything.
- **Every exit answers.** There is no path out of `runAgentTurn` that returns an empty string. A ceiling, a provider failure, a refused reply and a silent model each resolve to a sentence from `fallback.ts`.

## Running it

`pnpm test` runs everything here except the probes.

`pnpm agent:probe-turn` is the **shipping gate** for the first vertical slice: the ten cases in `eval/cases.ts` through the production tools, graded deterministically and then by the judge. It needs `ANTHROPIC_API_KEY`, writes `.agent-eval/turn-results.jsonl` (git-ignored), and `AGENT_LIMIT=2` runs a pilot of the eval first. **It has not been run.** ADR 0109's acceptance line is carried forward as the gate, and until this probe clears it no agent turn is put in front of a founder.

`pnpm agent:probe-seam` is the seam comparison ADR 0109 was decided on. `AGENT_SEAM=A` runs one arm, which is how the measured run was taken — both arms in one invocation is slow enough to be worth splitting. The offline numbers the ADR quotes are printed by `measure.test.ts` on every run.

# The file that was already six files

**Recorded 2026-09-02, after the work.** The last item of the audit's [Phase 5](../audits/2026-09-01-performance-code-health/README.md), held back from [0118](0118-what-two-tools-can-hold.md) and [0119](0119-the-schema-the-stores-read.md) so it could be a change that does nothing else. One commit, no behaviour.

`agent-execution/execution.ts` was 2,847 lines carrying the whole agent step graph. It is now a barrel over six step files and one shared module; the largest is 714 lines.

## Why the seams were not a judgement call

The file's own docblock draws the graph:

```
prepare ─▶ provision ─▶ run agent ─▶ extract ─▶ write branch ─▶ cleanup ─▶ settle
```

Each phase is already its own durable step, for a reason that sprint recorded: a pipeline inside one step races one platform ceiling, and the run that hits it leaves a paid VM alive with nothing responsible for it. **The boundaries existed; only the file did not respect them.** So the split follows them — provision, start, observe (poll and collect), verify, branch, finish — rather than inventing an organising principle.

## What made it safe to attempt at all

Before moving a line, the question was who depends on this file. Every importer of `agent-execution/execution` was enumerated and its import clause parsed: `workflow.ts`, three test suites, one concurrency probe. Between them they take **eleven symbols, and not one internal helper**.

That is what made a barrel the whole migration. `execution.ts` re-exports those eleven and nothing outside the module changed — so the diff could not carry behaviour even in principle. Six types that were exported turned out to be imported by nobody and are now file-local, which is the same tidy [Sprint 0117](0117-the-code-nothing-calls.md) made elsewhere, here for free.

## Proved, not asserted

A split is a diff where every line moves, and reading it is not a check. So the property was measured instead: **every non-import line of the original is accounted for in a step file or the barrel, and no line appears that was not there before** — 2,468 lines in, 2,468 out, compared as a multiset with the `export` keyword normalised away.

A first version of that check compared declaration bodies and reported eight differences. All eight were section-separator comments that a naive splitter attributes to the declaration above; the multiset comparison is what showed nothing was actually lost, and all nine `Step N —` separators survive.

## Two placements the first attempt got wrong

Both found by the tools, not by reading — which is the argument for doing this with the compiler and linter in the loop rather than by eye.

- **`buildRunProvider` belongs with `shared`**, not with the step that names it. `loadAgentRunContext` calls it, and that is shared by three steps.
- **`recordVerificationOutcome` belongs with `observe`.** `collectAgentStep` writes it, and it reads the two post-edit helpers beside it. Filing it under `verify` — where its name suggests it goes — made a cycle out of what is a straight line.

A third came from the mechanics rather than the design: the files moved one directory deeper, so every `../` import was resolving one level too high. `tsc` did not catch it, and the test run did.

## Verification

`pnpm lint` 0/0 · `pnpm typecheck` clean · `pnpm test` **7,311 tests in 423 files green** · `pnpm build` green.

The suite is the real check here, and it is unchanged: no test was edited, added or removed, because a pure move should need none.

**No E2E run** — the same container limitation as the last five sprints.

## What has not been proved

- **That the split is the right shape.** It is defensible — it follows the step graph, and no file exceeds 714 lines — but "is this the decomposition somebody would want in six months" is a judgement no check settles.
- **That `observe.ts` should stay one file.** At 714 lines it is the largest, and it holds two steps plus four recording helpers. Splitting poll from collect was considered and not done: they share `RunAgentOutcome` and the context read, and a boundary there would have been the kind this sprint was careful to avoid inventing.

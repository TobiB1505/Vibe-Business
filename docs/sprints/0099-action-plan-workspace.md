# UI-18 — Action Plan Workspace

Status: Implemented, browser verification green, not dogfooded

Date: 2026-08-26

## Outcome

The Action Plan route stacked two panels: every Move, then one plan underneath.
The relationship between them — *this plan is about that Move* — was expressed
only by document order, so a founder scrolled past the whole list to find out
what Vibe would do about the Move at the top of it.

The decision is now on the left and its explanation on the right. A Move card
links to `?plan=<id>`, the parameter [ADR 0028](../decisions/0028-founder-selectable-action-plan-move.md)
already defined, resolved exactly as before: a stale or foreign id degrades to
nothing rather than silently substituting rank 1, and a Move planned out of
priority order still says so. The side panel shows that Move's planned work —
the goal, why now, the steps with their own detail, the surfaces the change
lands on, what it depends on, what it still needs from the founder, and the
evidence behind it.

The founder-question step is unchanged. `FounderInputCard` moved into the panel
with its props untouched, so the redesign of that card against its own
reference is one file's work. What is new beside it is a count: `ActionPlanView`
now carries `openFounderInputCount`, filtered from the request list
`getLatestActionPlan` already loads, so a card can offer "Answer 2 questions"
only when two are genuinely open.

Nothing behind the screen moved. No migration, no schema change, no new module,
no provider, no AI call, no read added to the route.

## What the reference asked for and did not get

The supplied design carries four things the domain cannot support, and each was
answered rather than drawn:

- **A duration under every action** (`~1–2 hours`, `~3 min`). No duration field
  exists and `opportunities/schema.ts` §6 forbids one — `high | medium | low` is
  what the evidence supports. The slot carries the effort label, and a unit test
  asserts no digit-plus-unit ever appears in the card.
- **`~8–15 files` beside the expected change.** How many files a change touches
  is knowable only after the change exists (`changedFilesVerified`). The tiles
  are real: `deriveExecutionSurfaceRequirement` resolves them from the steps'
  evidence ids, so a plan of decisions and measurements names no surface and the
  section is absent rather than guessed (rule 57).
- **"This usually takes 15–30 seconds."** A promise about a paid inference call
  whose length nothing measures. The progress rows name the run's real stages
  from `operation_runs.stage`, and a tick appears only where the operation has
  genuinely passed one. No percentage and no step counter, as before.
- **A `Business Health` rail item.** Business Health *is* project Home
  ([ADR 0047](../decisions/0047-business-health-is-project-home.md)); the rail is
  unchanged.

`Export plan` was not built, because the feature does not exist and a button
that does nothing is worse than its absence.

## What changed in the copy

`Let Vibe prepare this` is now `Start with Vibe`. The confirmation dialog before
the repository write is unchanged, because that dialog is the authorization for
the write and not decoration on it. `Refresh my next moves` is now
`Re-scan business`, with the same explicit `force`, the same price disclosure
beside it, and the control absent rather than disabled when generation is
blocked.

## Verification boundary

The 25 assertions in `e2e/action-plan-ui.spec.ts` and the 31 in
`e2e/one-loop.spec.ts` pass, including the banned-copy sweep, the raw-enum and
internal-id leak sweep with every `<details>` forced open, and the founder
decision card rendering unchanged. Seven assertions in `one-loop.spec.ts` were
updated where this sprint deliberately changed what the screen says; each names
the change and keeps the invariant it was protecting.

Not proved: nothing was dogfooded. Every browser assertion runs against the
fixture route, so rule 69 has three of its four.

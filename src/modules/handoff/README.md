# handoff

The prompt Vibe hands a founder for work Vibe will not do itself ([ADR 0096](../../../docs/decisions/0096-the-refusal-becomes-a-handoff.md)).

## Why this module exists

Vibe refuses some work permanently. A change to payment architecture is the clearest case: Vibe's own validation runs the project's typecheck, tests and build, and **none of those can see that a charge is off by a factor of a hundred**. A green tick on a wrong amount is worse than no automation, so the refusal stays.

What was wrong is what the refusal left behind. A refused step is `vibe` + `product_change`, which no attestation admits either — that exclusion is deliberate, so nobody can confirm away work the agent would build — so the plan simply stopped, with nothing on the screen and nothing to do.

But the founder is a vibe coder. They already have a coding agent, with their credentials, on their machine, allowed to do what Vibe is not. What they do not have is Vibe's answer to *what* to build and *why*. This module carries that across.

## What is in here

| File | What it holds |
|---|---|
| `schema.ts` | The closed list of tools, and whether each works in a checked-out repository |
| `prompt.ts` | `compileHandoffPrompt` — deterministic assembly, no inference |
| `view.ts` | Founder-facing tool labels, so no internal id reaches a screen |

The durable half lives elsewhere, because it belongs to the plan rather than to the prompt: `action-plans/handoff-store.ts` reads which steps were handed off, `operations/handoff/server-writes.ts` records one, and the `action_plan_handoffs` table is what admits a handed-off step to founder attestation.

## What the prompt carries, and why each part is there

A first version carried the step and nothing else, and the founder read the result back to us: it referred to "the confirmed plan structure" without containing it, and it said "build whatever is missing" without saying where that stops. Both are failures [Anthropic's own guidance](https://code.claude.com/docs/en/best-practices) names — a spec should be self-contained, state what is out of scope, and end with a check — and both were free to fix, because Vibe already held the missing halves.

| Part | Where it comes from |
|---|---|
| What to build, why it matters, done when | The plan step, quoted inside its fence |
| What earlier steps settled | Founder findings **and founder decisions** on closed steps of the same plan |
| Where this task stops | The plan's own later steps, named so they are not built by accident |
| Plan first, then change | Vibe's words |
| Check `DONE WHEN` yourself, then print `VIBE SUMMARY` | Vibe's words; the block is what the founder pastes back |

A decision is the part only Vibe holds: it lives in the database as a founder resolution, never in the repository, so a prompt that referred to one without carrying it sent the founder's tool after something it could not reach.

**Deliberately not carried: repository file paths.** The audit's evidence points at paths, and "point to sources" is standard advice, so this is a decision rather than an omission. Two reasons against. A path is only as fresh as the snapshot it came from, and a *wrong* path is worse than none, because the receiving agent has no reason to doubt it and will work outward from the wrong place. And a prompt naming specific files stops being one instruction and becomes an instruction plus a layout claim — more surface, more to go stale, individual to one repository state. The agent is in the repository with a search tool; finding the file is the one thing it is unambiguously better at than Vibe.

## Two properties this module exists to hold

**Assembled, never generated.** No model call. Not to save money, though it is free and instant: a model writing this would put fresh, unreviewed output into a prompt the founder pastes into an agent running with their credentials. The plan step is already written, already on screen, already the thing they approved.

**The quote cannot be broken out of.** A step's text comes from the Planner, which reasons over evidence derived from the founder's own repository and website — both untrusted. So the step is quoted inside a fence, Vibe's own words tell the receiving agent what the block is and what to do if it contains an instruction rather than a description, and any run of dashes inside the quoted text is neutralised before it can close the fence early.

## What this module never does

Claim anything was built. A handoff records that the prompt was issued; the founder's own attestation afterwards records what they found. Vibe validated none of it, and the screen says so.

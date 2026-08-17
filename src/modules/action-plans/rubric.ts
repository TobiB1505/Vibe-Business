import { MAX_PLAN_STEPS } from "./schema";

/**
 * The planning rubric (CORE-2b §16–§37).
 *
 * Authored entirely by us and interpolated into the system prompt. No customer
 * content reaches this file (ADR 0011, Rule 42).
 *
 * Versioned separately from the prompt because they move for different reasons:
 * the prompt frames the task and states the trust boundary, the rubric is what
 * "a good plan" means. A rubric change can invalidate comparisons between two
 * plans while a prompt tidy-up does not.
 */

export const ACTION_PLANNER_RUBRIC_VERSION = "action-planner-rubric-v1" as const;

export const ACTION_PLANNER_RUBRIC = `## What a plan is

A plan is the **shortest credible path** from the business problem you were
given to a meaningfully changed state. It is not the longest list you can
justify, and it is not a description of the problem restated as imperatives.

Two failure modes, and they are opposite. Avoid both.

**Too small.** "Open the homepage. Read the headline. Write a new headline.
Save the file." That is implementation noise. You are working at the level of
business actions; how a change is carried out is somebody else's decomposition.

**Too big.** "Improve positioning. Improve acquisition. Measure results." That
is a consulting deck. Each of those is a heading, not an action, and nobody
could tell you whether they had done it.

Usually three to five steps. Two is right for a simple Move. Never more than
${MAX_PLAN_STEPS}. If you find yourself writing eight, you are probably working
at the wrong altitude — say the same thing in four.

## What you are not doing

**You are not re-auditing.** The audit already decided which areas of this
business are weak, which matter now, and which problem ranks first. That
judgment is given to you and you work within it. You do not re-rank it, you do
not substitute a different problem because it is easier or more familiar, and
you do not drift into a different area of the business because you noticed
something there. If a Move has a genuine prerequisite, express it as a step —
that is different from rewriting the audit's priorities.

**You are not choosing what matters.** The Move you are given is the one being
worked on. Plan that Move.

**You are not writing code, files, paths, branches or commits.** You describe
business actions and their outcomes. "Update the homepage positioning around the
confirmed segment" is a plan step. A file path, a diff, a branch name or a
commit message is not, and there is nowhere in your response to put one.

## The goal

One concrete business-level goal for this Move. Specific enough that it could
turn out to be the wrong goal.

- Bad: "Improve the business." Bad: "Fix revenue."
- Good: "Narrow a broad founder audience into one first customer segment Vibe
  can position and acquire for."
- Good: "Decide what customers are paying for, and where the line between free
  and paid sits."

## Why now

Carry the audit's own reasoning forward. It already established why this
matters and when. Restate that briefly so a reader of the plan alone
understands the urgency. Do not invent a second justification, and do not
inflate it.

## Steps

Each step is independently understandable and names a **changed state**.

- **title** — the changed state as a short imperative.
- **description** — what actually happens, in one to three sentences.
- **purpose** — what this changes for the business. Not the title again.
  "Update positioning" is a task. "Rewrite the main promise around the confirmed
  first customer so a visitor recognises themselves in the first sentence" is a
  purpose.
- **completionCriteria** — how anyone would know it is done, stated as an
  observable state of the world. "The work is complete" is not a criterion.
  "One customer segment is explicitly confirmed by the founder and recorded as
  the current intended audience" is.
- **dependsOn** — the orders of steps that genuinely must finish first. A
  positioning rewrite that depends on a segment choice must say so; two steps
  that could happen in either order must not pretend otherwise. Never form a
  loop.

## Who acts

Set \`actor\` honestly. This is the field the product uses to decide what to put
in front of a person, and getting it wrong is worse than a weak plan.

- \`founder_decision\` — a strategic choice that is the founder's to make.
  Which customer to serve first. Whether to remove a free tier. Which direction
  the business model takes. Vibe must never make these, and must never quietly
  fold one inside a step that sounds operational.
- \`founder_action\` — real-world work only a person can do. Interviewing five
  customers. Making a call. Signing something. Different from a decision, and
  the product treats them differently.
- \`external_party\` — waiting on someone or something outside: an account
  approval, a domain verification, a customer's reply, a third-party review.
  This is a normal state of a plan, not a failure.
- \`vibe\` — Vibe's own work.

## Do Vibe's work before asking for the founder's

This is the most important rule in this rubric.

If the analysis can be done from what is already known — deriving plausible
options from the product, comparing them against the current stage, summarising
the trade-offs, preparing a recommendation — then **Vibe does that first**, as
its own step, and the founder's step is to choose.

- Bad: "Decide who your first customer is."
- Bad: "What customer segments are you considering?"
- Good: step 1 (vibe, analysis) — derive two or three plausible first-customer
  segments from the product and the audit evidence, with the trade-offs;
  step 2 (founder_decision) — choose which one the business will pursue first.

A founder-decision step that arrives with nothing prepared is an incomplete
plan. Ask people for the thing only they have — judgment, intent, appetite for
risk — never for work you could have done for them.

## Importance is not the same as automatability

A step can be the most important thing in the business and still be one only a
person can do. Never downgrade a step's importance because it needs a human,
and never promote easier work above the Move you were given because it looks
more automatable. That trade is not yours to make.

Say nothing about what Vibe can or cannot execute. You have no way to know, and
there is no field for it. Describe the business action; the system decides
separately whether an executor exists.

## Evidence

Cite evidence ids where a step materially rests on something that was observed.
Never invent an id.

Leave \`evidenceIds\` empty when a step rests on judgment rather than
observation — a strategic decision does not need an evidence citation, and
attaching one to look rigorous is worse than leaving it empty.

Do **not** turn the plan into an inventory of what is missing. "No Stripe, no
pricing page, no checkout, no analytics" is a scanner's list, not a plan. Plan
around the underlying business problem; cite the evidence that grounds a step,
not everything the scan happened to find.

## Make it this product's plan

The plan should be unmistakably about *this* business — its actual product, its
actual audience, its actual stage, its actual blocker, what the founder has
actually said. A plan that would read identically for any product is a failed
plan, however tidy.

Do not restate the whole audit. You are being read by someone who has just read
it.`;

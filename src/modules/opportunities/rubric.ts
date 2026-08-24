/**
 * The prioritization rubric (Sprint 8 §11, §22).
 *
 * Product logic, versioned in source control. Changing what it says changes
 * what Vibe tells founders to do next, so it must never be edited without
 * incrementing `OPPORTUNITY_RUBRIC_VERSION` — two opportunity sets carrying
 * the same version have to mean the same thing.
 *
 * The rule that shapes everything else: **the lowest score is not the top
 * priority.** A product whose value proposition is unclear does not benefit
 * from a checkout flow, however badly monetization scores. Sequencing beats
 * severity, and the rubric says so explicitly because a model asked to
 * "prioritize" will otherwise sort by whatever number it was shown.
 */

export const OPPORTUNITY_RUBRIC_VERSION = "opportunity-rubric-v3" as const;

export const OPPORTUNITY_RUBRIC = `# Prioritization Rubric (${OPPORTUNITY_RUBRIC_VERSION})

Your task is to choose the few things this founder should work on next, and to
put them in the right order.

## How many

Return 3 opportunities. Return fewer only if the evidence genuinely does not
support 3. Return more than 3 only when a fourth or fifth is clearly of the
same calibre as the first three. Never more than 5.

A long list is a way of avoiding the decision. Choosing is the job.

## What qualifies as an opportunity

Every opportunity must be traceable to evidence. If you cannot cite evidence
ids that support both that the problem exists and that it matters, do not
raise it.

Specifically forbidden:

- generic startup advice that would apply to any product ("launch on Product
  Hunt", "post on social media", "talk to users") unless the evidence
  specifically supports it for this product;
- anything requiring knowledge you do not have — traffic, conversion rates,
  competitors, market size, funding, team;
- restating a lens score as an opportunity ("improve retention" is a
  score, not a piece of work).

## Ordering — sequencing beats severity

Do NOT order by which lens scored lowest.

Order by what should genuinely happen first. Consider:

0. **The audit already judged when each area matters.** Every business area in
   the audit's lens map carries a materiality: \`now\` blocks the founder's next
   milestone, \`soon\` follows it, \`later\` is a real gap whose prerequisites do
   not exist yet, and \`not_material\` does not apply to this kind of business.

   Start from that. An opportunity addressing a \`now\` area normally outranks
   one addressing a \`later\` area, **even when the later area scored worse** —
   a prototype with no privacy policy and no decided revenue model has a worse
   readiness score and a more urgent revenue question. A low lens score is
   severity; materiality is timing, and this list is about timing.

   You may still deviate where the evidence justifies it. Say so in the
   opportunity's rationale rather than reordering silently.

   An area the audit marked \`blocked_by_missing_context\` is waiting on
   something only the founder knows. That is a question, not a piece of work,
   and an opportunity that guesses the answer is worse than none.

1. **Prerequisites.** If one opportunity is wasted effort until another is
   done, the enabler ranks higher. A pricing page on a product whose value
   proposition is unclear is work spent twice.
2. **Stage.** A pre-launch prototype and a product with paying customers need
   different next moves. The founder's stated stage and primary goal are
   direct evidence of what matters now.
3. **Evidence quality.** An opportunity resting on strong, corroborated
   evidence outranks one resting on a single weak signal, even if the second
   would be bigger if true.
4. **Impact against effort.** Where two opportunities are otherwise equal,
   prefer the one that moves more per unit of work. This is a tiebreaker, not
   the primary rule.

State prerequisite relationships in \`dependencies\`. If opportunity 2 depends
on opportunity 1, say so.

## Impact, effort, confidence

These are three separate judgements. Do not collapse them.

- **impact** — if this were addressed well, how much could it matter for this
  business, given what the evidence shows? Not a guarantee, not a percentage.
- **effort** — roughly how much work is it? No hours, no days.
- **confidence** — how sure are you that the problem is real, matters now, and
  is supported by the evidence? "High impact, medium confidence" is a valid
  and useful combination. Low confidence is not a reason to omit a genuinely
  important opportunity; it is a reason to label it honestly.

## Missing evidence

Absence of evidence is not a licence to invent a fix.

If an area could not be assessed, the honest opportunity is usually to
**make it measurable**, not to build a feature for a problem nobody has
confirmed exists. "No retention data is available" supports instrumenting
retention. It does not support building a loyalty programme.

Only raise a measurement opportunity when the missing information would
actually change a decision. Not every unknown is worth closing.

## Execution classification

For each opportunity, classify what kind of work it is and whether Vibe could
do it:

- \`ready\` — Vibe could do this from what it already knows.
- \`needs_user_input\` — a decision only the founder can make comes first
  (what to charge, who to target, what the product stands for).
- \`not_supported_yet\` — real work, but outside what Vibe can do to a
  codebase or a website.

Be honest here. Labelling a pricing decision \`ready\` would promise automation
that cannot exist.

## Writing

\`problem\` states what is, in the present tense. \`whyNow\` says why it
deserves attention before the alternatives — grounded in this product's
evidence, not in general principle.

Plain, specific, no motivational language, no filler. A founder reading a
\`whyNow\` should learn something about their own product from it.`;

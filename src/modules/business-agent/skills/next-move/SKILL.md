# next-move

The founder has asked what to do next. They want one answer, not an inventory.

## What you are deciding

One recommendation, drawn from this project's own ranked work, with the reason
it is first and the honest state of the evidence behind it. A founder who asked
where to start and received a list has been handed their own question back.

## Procedure

1. **Read the focus first.** `get_project_focus` is Vibe's own deterministic
   answer to this exact question, computed from rows rather than judgement. It
   names what needs attention now, what else is true, and whether something is
   already running. Start from it. If something is running, say so — the next
   move may be to wait.

2. **Check whether the evidence can support a recommendation.** `get_business_health`
   returns the Business Audit reading and how old it is. Three cases, and they
   lead to different answers:
   - _No audit has run._ You cannot rank anything. Say that plainly, say what an
     audit would settle, and stop. Do not reason from what is typical.
   - _The reading is outdated._ You may still recommend, but name the age in the
     same breath and say the ranking rests on a reading that has not been
     refreshed.
   - _The reading is current._ Use it.

3. **Read the ranked Moves** with `get_opportunities` when the focus points at
   one or when the health reading names a priority you need the Move for. The
   ranking is the product's, not yours; do not re-rank it on a hunch. If the set
   is marked stale against a newer audit, say so.

4. **Read the plan** with `get_action_plan` when a Move has one, to find the
   first step that can actually be worked on. Pass the Move's id. If no plan
   exists, the next move is to plan it — say that, and do not describe steps
   that were never written.

5. **Find out what Vibe can do about it** with `resolve_execution` on that first
   step. The answer is a forecast, never a promise, and it decides one sentence:
   whether Vibe can build the step or whether it is the founder's to do. Never
   guess this. If the step is the founder's, say so in their words and do not
   imply Vibe will handle it.

6. **Choose one.** The primary recommendation is a single Move or a single step.
   Everything else you read is context for why that one is first.

## What the answer says

Four things, in prose, in this order, without headings or lists:

- **What to work on**, named the way the product names it.
- **Why it is first**, from the evidence you read — the audit's priority, the
  ranking, the plan's first open step.
- **What the evidence is worth**, if it is anything less than current: how old
  the reading is, what is missing, what would settle it.
- **What happens next**, and who does it. If Vibe can build the step, say the
  control will appear in the thread for them to press. If it is theirs, say that.

Keep the four states apart and never let one borrow the authority of another:

|                                 |                                           |
| ------------------------------- | ----------------------------------------- |
| **Fact**                        | a tool returned it                        |
| **Cached or outdated evidence** | a tool returned it and said how old it is |
| **Inference**                   | your reading of two facts together        |
| **Recommendation**              | what you would do, said as your judgement |

## Stopping

Stop when you can answer. If the evidence does not support a recommendation,
saying so _is_ the answer — reach for another tool only when it would change
what you say, never to fill the silence. A tool that errors is information: say
what could not be read and answer from what you have.

## What this skill never does

Rank by what usually matters for products like this one. Name a number no tool
returned. Say anything has started, run, merged, deployed or gone live. Promise
that a change will improve a metric. Offer a second and third recommendation as
a hedge against the first being wrong.

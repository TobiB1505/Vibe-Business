# 0110 - A question costs nothing, and is bounded

Status: Accepted, **provisionally** — the price is deliberately revisitable and the bound is not. See *What the owner still decides*.
Date: 2026-09-17

Decides the one thing [ADR 0109](0109-nova-first-application-shell.md) §5 left open: what a conversation turn costs and who pays. Introduces one `AIOperation`, `nova_conversation`, and one limit shape beside `operations/start-limits.ts`. Changes no retail price, no rate card, no reservation, no charge and no approval semantics. The restructure audit's §E.2 is the question; this is the answer.

## Context

Nova's conversation lane is a metered inference: a founder types a question, Vibe assembles a bounded context pack, the model returns a validated shape. Every other metered inference in this product is a **press with a price shown first** — that is rule 60, [ADR 0094](0094-a-free-operation-says-so.md) and `audit-is-a-choice.test.ts`, and it is one of the load-bearing properties of the whole Credit model.

A conversation cannot work that way, and the reason is not a technicality.

**A price on a question is a tax on understanding.** The founder who most needs to ask *"why is conversion the blocker?"* is the one least sure the answer is worth 2 Credits. They do not ask, they guess, and they spend 35 Credits on the wrong Move. The product is worse and the bill is higher. Every other priced operation in Vibe produces an artifact a founder keeps; a question produces a sentence that either helped or did not, and there is no honest way to quote that in advance.

**And the cost is not the reason to hesitate.** Measured on the voice tier's own numbers — 1,435 input and 157 output tokens on Sonnet 5 — one message costs about **$0.0044**. A conversation pack is larger, so call it an order of magnitude: still cents per founder per day, against $0.1965 for one audit and dollars for one agent run. The thing that could make this expensive is not the unit cost; it is an unbounded number of units.

**Rule 78 forecloses the alternative anyway.** *Never activate a customer-facing price without a measured cost behind it.* There are zero conversation turns in production and therefore zero observations. A retail price today would be a guess wearing a number, which is the failure that rule names.

## Decision

### 1. A conversation turn is free, and the surface says so

`nova_conversation` has no retail price, no Credit hold, no reservation and no `RetailOperationKind`. Like `nova_presentation`, it is Vibe's infrastructure cost rather than something a founder buys.

It is `free` in ADR 0094's precise sense and not `not_priced`: the policy has decided this costs nothing. Where the composer says anything about cost, it says **Included** — the word, never a zero.

### 2. It is bounded, and the bound is not optional

Free and unbounded is the shape that ends in an incident. Two windows, mirroring `operations/start-limits.ts` rather than inventing a second mechanism:

- **Per thread**, so one conversation cannot become a chat client.
- **Per account per window**, so an automated caller is refused before it is expensive.

A refusal is a sentence the founder can act on, never a silent failure, and it never spends anything. The numbers live in code with their reasoning beside them, the way [ADR 0068](0068-retention-periods.md) §7 requires of retention periods and for the same argument: a limit that can change without a diff is a limit nobody can say the value of afterwards.

### 3. Every call is counted before and recorded after

Rule 47 is unchanged by the price being zero. Tokens are counted before the call, a usage event is written after it for successes and failures alike, and the operation is keyed in the ledger exactly like every paid one — because Vibe is billed whatever the founder is charged. That is also what produces the measurements a retail price would eventually need.

### 4. The action lane keeps its prices

Nothing here touches what an *action* costs. A conversation that ends in *"run the audit again"* resolves to the same priced control the ranking offers, with the same price shown before the same press. Free applies to the sentence, never to what the sentence proposes.

## Consequences

- **A founder can ask anything without arithmetic.** Which is the product this decision exists to allow.
- **The bound is visible in the product**, because a refusal has to be. A limit a founder discovers by being ignored is worse than a price.
- **Vibe carries a cost with no revenue line against it**, deliberately and at a measured order of magnitude. `ai_usage_events` will say what it actually is within weeks of the first real conversation.
- **A future retail price is a new decision, not a switch.** It would need a measured distribution, a rate-card entry, a disclosure and a superseding ADR — the same path `agent_execution` took (rule 78).

## What the owner still decides

**This ADR is provisional in exactly one respect and firm in the other.** The *bound* is not up for discussion: free and unbounded is not an option. The *price* is, and the restructure audit's §E.2 names the three shapes — charged at retail like every other operation, absorbed as a free operation that says so, or absorbed and bounded. This adopts the third on the audit's own recommendation, and it was adopted without the owner in the room.

If the answer is *charge for it*, what changes is small and known: a `RetailOperationKind`, a rate-card entry, a reservation around the call and a `CostDisclosure` on the composer. Nothing in the conversation lane's safety model moves, because none of it depends on the price.

## Related

- [ADR 0109](0109-nova-first-application-shell.md) §5 — the two lanes, and the conditions this operation runs under
- [ADR 0094](0094-a-free-operation-says-so.md) — why `free` renders a word and not a zero
- [ADR 0086](0086-nova-presentation-is-claimed-stored-and-attempted-once.md) — the voice tier's five conditions, three of which this operation cannot use: a conversation turn has no reuse identity, because the same question asked twice is a second question
- [the restructure audit](../audits/2026-09-16-nova-first-restructure/README.md) §E.2 — the open decision this closes

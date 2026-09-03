# 0084 - Nova presentation inference is claimed, stored, and attempted once

Status: Accepted
Date: 2026-09-03

Amends §M of [the Nova architecture audit](../audits/2026-09-03-nova-architecture-audit/README.md), which lists "a Nova copy LLM call per message" under **What NOT to build**. Builds on [ADR 0082](0082-nova-voice-is-measured-not-argued.md), which decided the model and the prompt but not when a call may be made. Introduces one table, `nova_voice_messages`. Changes no execution authority, no approval path, and nothing about the four reasoning operations.

## Context

§M's objection is quoted in full because its wording is the whole decision:

> **A Nova copy LLM call per message.** §H. No reuse key, no ledger meaning, and every field it would summarise is already a founder-facing sentence in a stored document.

That is an objection to a *construction*, not to inference. The construction it refuses is a provider call reached from a render: a founder opens their project, the page builds a payload, the payload goes to a model, the sentence is displayed and thrown away. Every refresh pays again. Two tabs pay twice. A failed call pays and then pays again on the retry the next render performs. Nothing in the ledger can be reconciled against anything, because the same message has no identity from one visit to the next.

Slice 9 built `speakNovaMessage` and deliberately left it unreachable, with the reason recorded in its own docblock: it returns a reuse `identity` and nothing existed to check that identity against. This decision is what that was waiting for.

The distinction matters because the tier is not a cache in front of an expensive answer. A Nova message costs $0.0044 (ADR 0082), against $0.1965 for one Business Audit. Nobody is protecting a budget here. What is being protected is the property that **a founder's screen costs a bounded, knowable amount to look at**, and that the amount does not depend on how many times they refresh it, how many tabs they have open, or how often a provider fails.

## Decision

**Nova presentation inference is permitted only under five conditions, all five, together.** §M is amended to say that rather than to say no.

1. **A deterministic reuse identity.** Every output-relevant input is hashed into one key. Nothing about the message may vary that the identity does not cover.
2. **A persisted result.** The outcome of the single attempt is written to `nova_voice_messages` before it can be read from anywhere.
3. **Atomic single-generation semantics.** The right to make the call is claimed in the database, by an insert that either wins or loses. A loser never calls the provider.
4. **A deterministic fallback.** Every path that is not an accepted model sentence resolves to the template Vibe would have shown anyway — the same string, produced the same way, whatever went wrong.
5. **No provider call from the read or render path.** A read resolves an identity to stored text or to the template. It has no way to reach a model: the read function takes no provider, and the module's only import from `@/modules/ai/provider` is a type.

A call that cannot satisfy all five is still the thing §M refuses.

### The identity

```
sha256([ projectId, locale, canonicalPayload(payload), promptVersion, policyVersion, model ])
```

`canonicalPayload` fixes key order by hand rather than trusting `JSON.stringify` over an object literal, and it already carries the slot, the product name, the founder's goal, every fact label and value, the numeric allowlist, the confidence and the next step. The other five are each in it for a reason that is not "more inputs is safer":

- **`projectId`** — not for cache correctness but for tenancy. Two projects can produce a byte-identical payload; the generic slots make that likely rather than exotic. A row keyed on content alone would let one customer's stored message be served to another, and the row is customer data. Scoping the identity to the project makes cross-tenant reuse unrepresentable rather than merely prevented.
- **`locale`** — one member today, `en`, and that is exactly why it is in the hash. The failure it forecloses is the one that only happens once: a second locale ships, the identity does not move, and every founder in the new locale is served the English sentence from cache. A column with one legal value is a cheap way to make that a new identity instead of a support ticket.
- **`promptVersion`** — improving Nova's personality must not go on silently serving her old sentences.
- **`policyVersion`** — the validator's rules, the payload shape and the model policy move for different reasons than the prompt, and a stored message has to be invalidated by either.
- **`model`** — a model swap is a new message, never a reused one. ADR 0082 chose Sonnet 5 by measurement; a future re-measurement must not inherit the loser's output.

A message stored under a superseded identity is history rather than a cache miss. It stays readable, and whether anything regenerates is a decision somebody makes, not a consequence of a hash changing.

### What a fallback row stores, and what it does not

Both outcomes are persisted. They are not persisted the same way, and the asymmetry is deliberate.

An accepted sentence stores its **text**, because the text is the model's and cannot be reconstructed.

A fallback stores its **reason and nothing else** — no message column, by CHECK constraint. The fallback text is Vibe's own deterministic template, which the caller already holds; storing a copy would fix today's wording into a row that outlives it, so a reworded template would leave the old sentence on screen forever with no way to tell. Rule 83's problem, one layer down: a stored copy of a current-state string is a current-state document nobody remembers to update. So the row records *that this identity resolved to the template, and why*, and the read returns whatever the template says today.

This satisfies the requirement a fallback row exists for. What must not happen after a provider failure is **a second paid attempt on the next refresh**, and the row is what prevents it: the identity is resolved, so nothing claims it again.

### Attempted once means once, including after a crash

The claim is inserted before the provider is called and is never withdrawn. A process that claims an identity and then dies leaves a row that is claimed and unresolved, and that identity will never be generated again: every read falls through to the template, permanently, for that exact payload.

That is the intended behaviour and not a leak to be swept. The alternative — a claim that expires, or a sweep that releases stale claims — is a mechanism whose failure mode is a duplicate charge and whose success mode is a slightly nicer sentence. It is the wrong side of every trade this tier makes. `claim_gateway_request` reasons identically one layer down: never decremented, because a counter that gave attempts back on failure would be a counter an unreliable network could reset.

The founder loses nothing they can see. They get Vibe's own sentence, which is the sentence the product is complete with.

### Where the writes come from

`select` is granted to `authenticated` under an RLS policy that joins through project ownership, because a render reads. `insert` and `update` are service-role only, and there is no `delete` grant at all: an attempt is a record of a charge that may have happened.

Rule 53 confines the service-role client to `src/modules/operations/` plus argued exceptions in `REVIEWED_SITES`. This decision does not choose which of those the eventual generation path is, because nothing generates yet — it fixes the constraint that it must be one of them.

## Consequences

**Reads cannot spend.** The read path's inability to reach a provider is structural rather than careful: `readNovaVoiceMessage(supabase, { identity, template })` has no provider parameter, so a render that wanted to generate would have to be rewritten rather than merely edited. A source contract asserts the module's only provider import is `import type`.

**Concurrency is settled in Postgres, not in a process.** `insert … on conflict (identity) do nothing … returning` is one statement the database serializes; the caller learns whether it won by whether a row came back. Two servers, two tabs, two Vercel regions and one page rendered twice all reduce to the same one winner. An in-memory guard would have been correct on one instance and wrong in production.

**Nothing calls any of this.** The slice ends at the migration, the store, the identity contract, the tests and this record. `ensureNovaVoiceMessage` composes claim-then-speak-then-resolve and is reachable from tests only, exactly as `speakNovaMessage` has been. Wiring it to a feed, a page or an operation is a separate decision with its own evidence — including where the usage event is written, which is unresolved here because nothing has been billed yet.

**Slice 9's safety properties are unchanged and still load-bearing.** Tokens are counted before the provider is invoked; usage is preserved on failures so a billed attempt is recordable either way (rule 47); `checks.ts` validates what the model actually wrote rather than what it was asked for; and a rejected message resolves to the template rather than to a second opinion. There is no retry anywhere in this design — not for a provider failure, not for a validator rejection, not for a malformed response.

**What this does not establish.** That the voice is worth having. Its measurement is ADR 0082's and stops at prompt quality; whether a founder reads a rephrased sentence differently from a template is unmeasured and is a dogfood question. This decision only makes it safe to ask.

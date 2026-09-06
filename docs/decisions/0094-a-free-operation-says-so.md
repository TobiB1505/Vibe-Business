# 0094 - A free operation says so

Status: Accepted
Date: 2026-09-05

Supersedes the rendering rule recorded as BILLING CORE-2 §56 and carried in `credit-price.tsx`. Changes no price, no policy, no reservation and no charge — only what a control says about a price that is already `free`.

## Context

§56 decided that an operation the rate card prices as `free` renders nothing at all beside its control, and the argument was specific:

> a zero beside a button invites the question of when it might stop being zero, and free operations are simply not part of the Credit conversation

That was right about `0 Credits`, and it is still right about `0 Credits`. A zero is a number in a currency, and a number invites arithmetic — what it was, what it will be, whether it is about to change. It reads as a price of nothing rather than as an absence of price.

What it got wrong is the step from *"do not print a zero"* to *"say nothing"*, and the cost of that step was invisible until the sources went on one screen. `product_understanding` is `free` under `launch-v1`. So on My Product:

- **Deep Scan** — "Deep Scan · 25 Credits"
- **Scan again** — "Scan again"

Two remedies, side by side, one priced and one silent. A founder who has learned that this product states its prices reads the second one as a price that has not loaded, or as one that will appear at the confirmation step, or as an oversight. Silence is not read as *free* on a screen where everything else that costs money says so — it is read as *unknown*, and an unknown price is the thing a Credit system exists to prevent. The audit reaches the same place from the other direction (E14): four evidence sources, each with a remedy, and the founder cannot tell which of them will spend Credits.

The distinction §56 protects survives intact, and it is worth naming: `free` and `not_priced` are different answers. `free` means the policy has decided this costs nothing. `not_priced` means the policy has no price for it and would refuse — there is nothing to say, and saying "Free" would be inventing an answer the policy did not give.

## Decision

**A control for a `free` operation renders the word, not the number.** `Included` — one word, in the same slot the price occupies, styled as metadata rather than as a claim.

Three properties hold it to what §56 was actually defending:

1. **No zero, ever.** `0 Credits` is not rendered anywhere, in any state. The word replaces the number rather than accompanying it.
2. **`not_priced` still says nothing.** An operation the policy will not price has no price to disclose, and a word there would be a fabrication.
3. **One resolver.** The word comes from the same `resolveRetailPrice` call the reservation makes. There is no second place where "free" is decided, so a rate card that starts pricing `product_understanding` moves the word to a number with no UI change.

"Included" rather than "Free" because it is the more precise claim: the operation is part of what the account already has, which is what a `free` price in `launch-v1` means. "Free" reads as a promotion, and a promotion implies an end date this product has not set.

## Consequences

**Easier.** A founder can tell, before pressing anything, which remedies spend Credits and which do not — on My Product, in the source coverage list, and anywhere else a control names an operation. The audit's E14 gap closes without a second vocabulary for money.

**Harder.** Every surface that renders a control now renders something in the price slot for every priced *or* free operation, so a layout that assumed the slot could be empty has one more line to accommodate. `not_priced` still empties it, so the slot cannot be assumed non-empty either.

**Forecloses.** Rendering `0 Credits` remains out of bounds, and this decision is not a licence to reopen it — the argument in §56 against a zero beside a button stands and is the reason this is a word.

**What is not decided here.** Whether `product_understanding` should be free at all. That is the rate card's question, `launch-v1` answers it today, and this decision would render whatever answer replaces it.

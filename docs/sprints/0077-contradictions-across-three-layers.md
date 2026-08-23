# Sprint 0077 — the contradiction only two runtimes can see

Status: **Half the entry closed, the other half deliberately deferred with a decision recorded.** The first ROADMAP entry this session whose every claim held up when checked.

## The entry, verified

> `repository-intelligence/cross-check.ts` makes four fixed repository-vs-live comparisons, consumed only by `intelligence-summary.tsx`. There is no `contradiction.*` evidence, and no live-vs-Deep-Scan comparison at all — which is where the most valuable monetization contradiction would be.

Four claims, all four true:

- **Four comparisons** — counted in the code, not the header: four `checks.push` blocks, all deterministic.
- **One consumer** — `intelligence-summary.tsx` and the module's own test. Nothing else imports it.
- **No `contradiction.*` evidence** — no such namespace is minted anywhere. Every hit for the word is prose in unrelated modules.
- **No live-vs-Deep-Scan comparison** — `buildIntelligenceCrossChecks` took two snapshots and the authenticated one was not among them.

Worth recording plainly, because four of the last five entries this session had a false claim in them. This one did not.

## What shipped: the third layer

Two comparisons, between the public site and the signed-in product:

- **`billing-not-offered-publicly`** — a Deep Scan found a billing area; the live site has no pricing and no checkout. *"Your product can be paid for, but nothing public says so."*
- **`pricing-without-billing`** — the live site shows pricing; the signed-in product has no billing area. *"Visitors are shown pricing your signed-in product cannot act on."*

**Neither is reachable from code**, however carefully the repository is read, because both layers involved are runtime. A product can contain a complete billing implementation and still never offer it to a visitor — and the four existing repository-vs-live comparisons report that as healthy, because the code and the site agree with each other about a page that exists.

The Deep Scan was already loaded by the project page. It simply never reached the comparison; the parameter is optional, so every existing caller and finding is unchanged.

## The guards are the point

A Deep Scan is optional and can fail, and both cases must produce **silence**:

- **Never run** → no finding. "Vibe did not look" and "Vibe looked and found nothing" are opposite facts, and only the second can contradict anything.
- **Reached nothing** → no finding. A failed sign-in reports every surface undetected; reading that as "this product has no billing" would turn one broken credential into a finding about the founder's business.

Both mirror the guards the live comparison already had, and both are tested. The no-Deep-Scan test asserts first that the same fixture *with* a scan does produce the finding — without that, it would pass for the wrong reason.

## Proof

Disconnecting `crossCheckSignedInProduct` turns three tests red: the two findings, and the anti-vacuity assertion inside the silence test. Restoring turns them green.

## What is deferred, and why it is a decision rather than an omission

**Contradictions still do not reach the model.** Closing that means minting `contradiction.*` evidence into the pack, which forces `business-evidence.v4` — the pack version is part of `computeAuditInputHash`, so adding items to what the model sees must invalidate reuse.

[Sprint 0073](0073-evidence-id-polarity.md) already reserved v4 for a different change: the evidence-id polarity migration, which needs a version-aware reader because renaming ids would leave every stored citation rendering under the old, wrong polarity.

So there are now **two** reasons to want v4, and doing them as separate bumps would cost two invalidations for work that belongs in one. The decision to design them together is recorded in [ADR 0044](../decisions/0044-evidence-pack-v4.md), which also names an interaction found while scoping this: `verifyPackProvenance` discriminates on `evidence_pack_version === "business-evidence.v3"` exactly, so a v4 row would silently fall to the pre-CORE-2 path — the v4 change must widen that to "v3 or later" in the same commit.

That interaction is the concrete argument for the deferral. It was found by scoping the work, not by doing it, and it would have been a quiet regression in a hurried bump.

## What this does not do

**It does not add a `contradiction.*` evidence namespace.** See above; it needs v4.

**It does not compare code against the Deep Scan.** A repository containing billing code while the signed-in product shows no billing area is a plausible fifth comparison, but "the code has it and the running product does not" is already what `payments-not-reachable` says through the public layer, and a second phrasing of the same finding is worse than one. Named rather than quietly added.

**No migration, no schema change, no version bump.**

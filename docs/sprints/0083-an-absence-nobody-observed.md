# Sprint 0083 — an absence nobody observed

Status: **Absence claims derived from unreadable pages are no longer minted. No fourth invariant, because the proof said one was not needed. SEO coverage counts readable pages only. No migration, no version bump, no schema change.**

## Why Sprint 0082 was not enough

Sprint 0082 gave the evidence pack a sentence: *"Anything reported as absent on those pages is unread, not missing — do not treat it as a finding."*

It sat at priority 1, **beside** a dozen absence claims at the same priority:

- `live.surface_absent.pricing` → *"Live surface not detected: Pricing"*
- `live.seo.title_missing` → *"SEO foundation absent: Title"*
- `live.conversion.signup_cta` → *"No signup/trial call to action was detected"*

Every one of those ids was **valid**, so a model could cite one, `filterEvidenceIds` would keep it, and the dimension would score. The warning competed with the claims instead of governing them — and rule 44 is explicit that this belongs in code rather than in a prompt.

## The rule, and where it came from

**An absence derived from a page Vibe could not read is not minted at all.**

That is not a new idea in this file. Sprint 0079 already wrote it for declared pricing — *absence is minted only when the pricing surface was actually reached* — and stated the reason: "no declared price on a site whose pricing page we never fetched" is not a fact about the business. This sprint generalizes that one precedent to the three signal families that had the same problem.

**Presence is deliberately untouched.** A call to action found on a readable page is a fact whatever the rest of the site did.

The gate differs by family because the derivation differs:

| family | gated on | why |
|---|---|---|
| SEO signals | the **homepage** being readable | eight of the ten are document-level and read from the homepage alone |
| product surfaces | **any** page being readable | detected across the crawl, from paths and titles |
| conversion CTAs | **any** page being readable | collected across every page the crawl read |

Each suppressed family leaves one clearly-worded item behind — `live.unobservable.seo`, `.surfaces`, `.conversion` — so the omission is legible rather than silent. The namespace is new on purpose: `live.surface.` is `SURFACE_NAMESPACES.live.present`, so `live.surface.unobservable` would have parsed as a surface citation named "unobservable", and `live-premise.ts` selects the ids it revalidates by `endsWith("_missing")`, so a `_unobservable` suffix would have entered the paid revalidation path. A test pins both.

## The invariant that was proposed and not built

The plan was a fourth invariant in `validate.ts`: force `insufficient_evidence` when every surviving citation is unobservable. It was not built, because a test was written to check whether it was needed and the answer was no.

With the id gone from the pack, `filterEvidenceIds` drops the citation, the dimension is left with none, and **invariant 2 already forces the status**. Both sides are recorded in `validate.test.ts` so the counterfactual is not lost:

| pack contains `live.surface_absent.pricing` | same model output scores |
|---|---|
| yes | `assessable`, **30/100** |
| no | `insufficient_evidence`, `null` |

That makes the enforcement an **absent capability** rather than a denied one — CLAUDE.md rule 76's shape — and the rule that does not exist cannot be got wrong.

## The coverage denominator

`SeoSignalCoverage.pagesInspected` counted every fetched page. A shell contributes a guaranteed miss to a document-level signal because there is no document, so a site with two readable pages and two shells reported the homepage's description as *"missing on 3 of 4 pages Vibe read"* — a sentence wrong twice over: Vibe read two, and it knows nothing about the other two. Counted over readable pages only, the same site reports `{pagesWith: 1, pagesInspected: 2}`.

Proven red at `pagesInspected: 4` before the fix, against a four-page fixture with two real pages and two shells.

## What was found and not fixed

- **A stored snapshot from before Sprint 0082 stays fully observable.** It carries no per-page verdict, so suppression cannot apply, and it must not: silently removing evidence an older audit was already reasoning from would change what that audit is understood to have seen. There is a test.
- **A partly client-rendered site still reports surfaces and CTAs normally.** That is correct — they were collected from the readable pages — but a surface that exists *only* behind a shell will read as absent, and nothing distinguishes that from a surface that is genuinely missing. Narrower than the gap this sprint closed, and left open.
- **`git checkout <file>` cost a reapply.** A temporary revert during red-proofing overwrote work that was not yet committed. The scratchpad-backup pattern used everywhere else in this session exists for exactly that reason.

(lint 0 errors/typecheck clean/**6,375 tests**/build green)

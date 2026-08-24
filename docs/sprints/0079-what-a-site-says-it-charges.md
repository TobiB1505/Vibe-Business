# Sprint 0079 — what a site says it charges

Status: **The declared half shipped. The observed half is named and not built.** No migration, no pack version bump.

## The entry, verified

> All eight document-level SEO signals and the entire brand block are read from the homepage only. `/pricing` is fetched at top priority and yields a title and CTA labels — no prices, plans or billing period — for a product whose central dimension is monetization. Headings are parsed, capped at 40 per page, and thrown away.

| claim | verdict |
|---|---|
| SEO + brand read from the homepage only | ✅ `buildSeoSignals({ homepage })`, `buildBrandSignals({ homepage })` |
| `/pricing` fetched at top priority | ✅ `crawler.ts` — `pricing: 10`, the highest |
| No prices, plans or billing period | ✅ **no price extraction of any kind existed**; the only `plan` matches are CTA text patterns |
| Headings capped at 40 | ✅ `MAX_HEADINGS = 40` |

**One imprecision.** Headings are not *thrown away* — `classifier.ts` reads their text to classify a page. They are used transiently and never persisted; only `headingCount` survives. "Parsed, used for classification, and never kept" is the accurate sentence.

## The research changed the approach

`ParsedHtml` already carried `structuredDataTypes: string[]`. The JSON-LD walk ran on every page, collected the `@type` values, and **threw the payload away** — which is exactly where a pricing page states its own prices, in `Offer` / `Product` nodes carrying `price` and `priceCurrency`.

So the entry's implied approach (scrape the rendered text) is the *weaker* of two, and the stronger one was already half-built. A declared `Offer` is what the operator published about their own business. A number lifted from rendered text could as easily be a discount, a struck-through figure, or an "from" amount.

The walk was **extended, not duplicated**: the JSON is parsed once and both collections share one set of budgets.

## Strict about what counts

An offer needs a parseable amount **and** a three-letter currency, or it is dropped whole. `"29"` with no currency is not a price a founder can be shown, and defaulting one would be an invention. Also refused: a price carrying its own symbol (`"$29"`), comma-grouped thousands (`"1,299"`), ranges, negatives.

A misparsed price reaches a founder as a statement about their own business, which is worse than a missing one.

**A period is only named when it is exactly one unit.** `P3M` states a real billing period this vocabulary has no name for, and rounding it to "month" would understate what a customer is charged by two thirds. Unnamed is the honest answer.

**The enclosing product's name is carried down the walk**, because the common shape is a named `Product` wrapping an unnamed `Offer` — that is what turns a bare amount into one of the founder's own plans.

## Two absences, kept apart

- **An empty price list is never a free product.** `declaredPricePoints: []` means "the site did not say".
- **"No declared price" is only minted once the pricing page was actually reached.** Otherwise a model is handed *Vibe's own coverage gap* as though it were a fact about the founder's business — precisely the failure the audit's `insufficient_evidence` rule exists to prevent.
- **A declared zero is a stated free tier**, which is a different thing from silence.

Both guards are proven red: removing the reached-check, or reading the field unconditionally, turns exactly those two tests red.

## Why no pack version bump

The pack builder is deterministic given its inputs. A snapshot gaining a field changes the pack because the *input* changed, not the builder — and the audit identity already hashes the snapshot **id**, so a new snapshot invalidates reuse correctly while an old one rebuilds byte-identically. The field is optional for exactly that reason: the Opportunity Engine and the Action Planner rebuild a stored audit's pack from its snapshots, and a builder reading it unconditionally would mint ids the audit never cited.

## What this does not do

**No text-observed prices.** This is the significant limitation, and it bounds the feature's reach: **most sites publish no `Offer` at all**, so for many founders this will find nothing. That is honest silence rather than a wrong number, but it is silence. The observed half — a currency token and an amount near a heading, recorded at lower confidence and never merged into the declared list — is the natural next commit.

**The homepage-only half of the entry is untouched.** SEO signals and the brand block still read the homepage alone. Named here, still open.

**Headings are still not kept.** Using them to attach a plan name to an observed price is part of the text half, not this one.

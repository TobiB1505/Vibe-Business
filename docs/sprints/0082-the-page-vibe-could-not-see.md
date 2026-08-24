# Sprint 0082 — the page Vibe could not see

Status: **A rendering verdict per page, a readability block per site, and one new completeness reason. `LIVE_PRODUCT_ANALYZER_VERSION` → `live-product-analyzer-v3`. No migration, no evidence-pack bump, no browser.**

## The entry, verified

> There is no rendering signal, so "we could not read this" is indistinguishable from "there is nothing here" — the failure mode the audit's own `insufficient_evidence` rule exists to prevent.

Every claim held, and the middle one was measured rather than reasoned about. A real Vite shell was fed to the actual parser:

```
{"headings":0,"links":0,"buttons":0,"forms":0,"title":"Acme","description":null,"canonical":null,"structuredData":false}
```

`CrawlCompletenessReason` had nine members and every one of them was about the crawl stopping short — budgets, timeouts, `robots.txt`, a failed fetch. Nothing meant *the page came back fine and there was nothing in it*. So a site of shells returned HTTP 200 on every page, respected every budget, and produced `completeness: "complete"`.

That snapshot then asserted, as fact, that the product has no calls to action, no signup form, no pricing and no headings. `insufficient_evidence` exists in the audit for exactly this, and rule 44 requires it be enforced in code rather than in a prompt — but nothing could enforce it here, because nothing knew.

## Why two verdicts, not one

`empty` and `client_rendered` are different statements, and only one of them is about Vibe.

A coming-soon page with one line of text really is nearly empty, and Vibe read it correctly. Reporting that as "could not read" would be a false alarm — and a false alarm teaches a founder to ignore the warning that matters. So emptiness alone is recorded as an observation about the page and changes nothing about completeness.

`client_rendered` needs a second, independent fact: an empty mount element, or a `<noscript>` asking for JavaScript. Both are **the page describing itself**. Only that combination claims the read failed.

Sparseness is required for both, which is what keeps the self-description signals honest:

| case | why it is not flagged |
|---|---|
| Next.js server-rendering into `#__next` | the markup is *inside* the mount element, so it is not empty |
| a content site shipping "please enable JavaScript for the best experience" | it already gave us something to read |
| a page with one `<h1>` and nothing else | a heading is proof the server sent markup |
| a login page that is only a form | so is a form |

All four are tests, and so are the three shells — Vite, Create React App and Vue — taken from what those tools actually emit rather than approximated.

## Why it joins `CrawlCompletenessReason` rather than standing beside it

`client_rendered` is the one member of that type that is not about the crawl stopping short, and the type now says so in place. It shares the type anyway because the *consequence* is identical and already respected everywhere: absence in a `partial` snapshot must not be read as a fact about the product. A second, parallel flag would have to be honoured by every consumer separately, and the first one to forget would state a zero as the truth — which is the defect this sprint is fixing.

`LiveReadability` carries the detail the reason cannot: how many pages were readable, how many were genuinely empty, how many were shells, and which paths those were.

## What the model and the founder are told

The evidence pack states it **before** the completeness line and at the highest priority, because it changes how every other live item must be read:

> *2 of 3 page(s) build themselves in the browser, so Vibe fetched markup a visitor never sees (/app, /pricing). Anything reported as absent on those pages is unread, not missing — do not treat it as a finding.*

The human view gets its own sentence rather than joining the reason list, because the existing wording — *"so some of the results above may be incomplete"* — is far too mild for this case. On a shell, almost everything above it is unread rather than absent, and a founder told only that the check "did not finish completely" would reasonably conclude their product has no calls to action.

**Both consumers were interpolating the raw enum.** `page_budget_reached` is not a phrase, and a test in `human-view.test.ts` had been *asserting* that the raw member appears in the founder-facing string. That assertion is now inverted: the sentence must contain the words and must not contain the member.

## What is deliberately not done

**Vibe still runs no browser, and this sprint does not argue about that.** ADR 0010 and rule 38 ban exactly the headless-browser dependencies that would make the problem disappear. This reports the limit where it bites; it does not remove it, and removing it would need its own ADR rather than a new dependency.

**No evidence-pack version bump.** `live.rendering.client_rendered` is a new id, not a changed one, and it is minted only from a `readability` block that only a v3 analyzer writes — so a v2 snapshot rebuilt today mints nothing it never cited. The same argument Sprints 0079 and 0081 made.

**Both new snapshot fields are optional.** `live_product_intelligence_snapshots.result` is a JSON column holding whatever analyzer wrote the row. A stored v2 snapshot has no `readability` and no per-page `rendering`, and it must read as "readable" — inventing a warning for an old snapshot would be a claim no analyzer ever made. There is a test for that.

## What was found and not fixed

- **The verdict does not reach the audit's own scoring.** The pack now says the absences are unread; whether the model honours that is the model's behaviour, and this sprint adds no independent enforcement of it. Rule 44's enforcement in `validate.ts` still keys on a dimension citing no evidence, not on the evidence being unreadable. That is a real, separate gap.
- **A partly client-rendered site still reports site-level signals from readable pages.** That is correct — the readable pages were read — but the SEO coverage count now has a denominator that includes pages nothing could be counted from. Named, not fixed.

(lint 0 errors/typecheck clean/**6,364 tests**/build green)

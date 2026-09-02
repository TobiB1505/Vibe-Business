# The pages the change touched

**Recorded 2026-09-02, after the work.** Etappe 3 of the plan built from the
codebase-fitness audit, and the one the plan called the answer to the founder's
core question: the measurement half of the product could not see the only kind
of change the product actually produces.

## The gap

`execution/outcome-contract.ts` mapped `agentic_execution_v1` to `null`. Every
change the coding agent produced resolved to `outcome_not_supported`, so a
founder merged an agentic change and Vibe said nothing about what happened next.
The measurement half was wired to two deterministic SEO generators and to
nothing a customer's agent had ever built. It had been a roadmap entry for three
sprints.

The comment recording that decision is worth quoting, because it is not a
mistake — it is a good argument that stopped one step early:

> A verifier answers "is the thing this change was supposed to do actually true
> in production now?" — and it can only do that because it knows what the change
> was.

True, and rule 57 closes the obvious escape: the step's `doneWhen` prose is
model output and may not control anything. What the comment concluded from it —
that any profile would be either a lie or a check so generic it is worse than
nothing — skipped the third option.

Vibe holds two observations of its own about every agentic change: **which files
changed**, from its own filesystem comparison rather than the agent's account of
its work (rule 77), and **which public URL each of those files serves** at the
pinned commit, from the analyzer's route table. Their intersection is a fact
about *this* change, produced entirely by Vibe, and the plan's own instruction
was to measure before building it.

**The measurement, first.** 9 of 10 recorded agent runs resolve a `public_pages`
surface (`execution_surface_resolved`, since 2026-08-19). Had that come back
"few", this stage would have moved behind Etappe 4.

## What the plan asked for, and what does not survive contact

The Etappenplan named the expectation as *"these routes answer after the merge,
and their content is no longer identical to what was there before"*. The second
half is not built, and the reason is written into the ADR so it is not proposed
again:

- **There is no pre-merge moment to fetch a baseline in.** Outcome verification
  is started by the founder, from a button, possibly hours after the merge.
  Capturing a baseline inside the merge operation would put an outbound request
  in front of a consequential write — for a signal the next point destroys.
- **A page hash is not stable.** CSRF tokens, timestamps, session and analytics
  identifiers, A/B assignments and cache busters differ between two consecutive
  fetches of a page nobody changed. "The content differs" would pass on a site
  nothing was deployed to, which is a false `verified` — and reading the hash
  equal would be just as weak the other way. The check fails in **both**
  directions, which is what makes it not a weaker version of a good idea.

So this profile does not read a page's body at all. That is stated as the
boundary of the claim rather than as a limitation to work around later: it
verifies **reachability, never arrival**. A 200 is equally consistent with the
previous build still serving.

## What was built

`agentic_public_routes_outcome_v1`, with one check kind whose whole meaning is
one sentence: *this path answered as a page, at the path Vibe asked for.*

```
2xx HTML at the requested path   → passed
2xx HTML somewhere else          → not_observed   a different page was served
404 / 410                        → not_observed   the page is not published
5xx, or served as not-a-page     → failed         the origin contradicts us
401 / 403 / 429 / transport      → error          Vibe could not look
```

The `error` row is the one worth defending. A bot-blocking WAF and a rate
limiter answer 403 and 429 on a perfectly healthy page, and Sprint 12A's own
discipline is that a fact about our request never gets reported as a fact about
somebody's product. Only a 5xx — the server saying it is broken — becomes
`failed`.

**Why the weak claim is worth making anyway** is the failure direction. The most
expensive thing this pipeline can do is merge a change that takes a public page
to a 500. That now reads as `failed`; it used to read as "Vibe cannot verify
this kind of change".

### Where the limit is written down

Four places, because a sentence in a docblock does not reach a founder:

- `OUTCOME_PROFILE_SCOPE_NOTES` states it once, in the domain.
- `OutcomeCard.profileNote` carries it as a **field**, so a redesign of the panel
  cannot drop the line — the same reasoning `businessImpactMeasured` was made a
  field for.
- The panel renders it in every state, including before the click.
- The check label says "`/pricing` answers", not "works", "is live" or
  "updated". `outcome-ui.test.ts` greps the panel source for "is live", and it
  caught a docblock in this sprint that used the phrase to explain why it must
  not be used.

### Refusals stay separated

A backend-only change gets `outcome_no_public_surface`, not
`outcome_not_supported`. Different sentences: the first says this change has
nothing public behind it, which is the ordinary shape of backend work; the
second says Vibe cannot verify this kind of change, which is no longer true and
would now be a false statement on a card.

### Bounds, and two exclusions that are not details

`maxObservedRoutes: 4`, applied by the contract and **re-applied at observation
time** — a frozen expectation written under a larger budget must not be able to
spend today's requests.

- **Dynamic routes are never probed.** `/app/projects/[projectId]` is a
  template, not a URL. Requesting it literally observes a 404, which this
  profile would report as the change having broken a page.
- **Authenticated pages are never probed.** An anonymous GET of one observes the
  login screen, which is a fact about the login screen.

## What this cost, and what it did not

26 tests, one migration widening one CHECK, and no new dependency, no new
outbound client and no browser. Every request goes through `safeFetch`, the same
door live product intelligence uses — rule 35 and ADR 0010 — so the address
gate, the pinned connection, the per-hop redirect revalidation and the byte
budget arrive unchanged.

The page budget is the crawler's own 1 MB rather than something smaller, and the
reason is a defect avoided rather than a preference: `node-transport.ts` refuses
a response whose declared `content-length` exceeds the budget, so a budget sized
to what this profile actually reads — a status line and a content type — would
have rejected most real pages before their status was observed, and reported a
healthy site as unreachable.

## Not dogfooded

The path is free and read-only, and it has not run against a real merged agentic
change. What would exercise it is one "Check production outcome" click on an
agentic change whose step touched a page — which is a founder action on a real
merge, not something this sprint could manufacture.

## What is still open

Arrival. Closing it needs a signal about which build is serving, which means a
deployment provider — Vibe calls none today (rule 74) — with its own
permissions, its own failure modes and its own ADR. The roadmap entry is closed
for reachability and says so in those words.

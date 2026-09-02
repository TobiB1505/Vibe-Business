# 0071 - Outcome verification for agentic changes: routes Vibe observed, not intent it was told

Status: Accepted
Date: 2026-09-02

Extends [ADR 0020](0020-production-outcome-verification.md). Nothing in that ADR
is reversed: the vocabulary, the window, the safe-fetch boundary, the evidence
policy and the refusal to read a deployment API all stand.

## Context

`execution/outcome-contract.ts` mapped `agentic_execution_v1` to `null`, so
every change the coding agent produced resolved to `outcome_not_supported`. The
measurement half of the product was wired to two deterministic SEO generators
and to nothing a customer's agent had ever built. A founder merged an agentic
change and Vibe said nothing about what happened next.

The comment recording that decision argued it well, and its first half is still
true:

> A verifier answers "is the thing this change was supposed to do actually true
> in production now?" — and it can only do that because it knows what the change
> was.

An agent-produced change has no fixed shape by design, so nothing can state what
it was *supposed* to do. [Rule 57](../../CLAUDE.md) closes the obvious escape:
the step's `doneWhen` prose is model output and must never control anything.

What the comment then concluded — that any profile here would be either a lie or
a check so generic it is worse than nothing — skipped a third option. Vibe holds
two observations of its own about every agentic change:

- **which files changed**, from its own filesystem comparison rather than the
  agent's account of its work ([rule 77](../../CLAUDE.md));
- **which public URL each of those files serves**, from the repository
  analyzer's route table for the pinned commit — the same input
  `review/classification.ts` already decides a visual review from.

Their intersection is a fact about *this* change, produced entirely by Vibe.

**Measured before building.** 9 of 10 recorded agent runs resolve a
`public_pages` surface (`execution_surface_resolved`, since 2026-08-19), so this
is the ordinary shape of agentic work rather than an edge case.

## What was considered and rejected

**Comparing page content across the merge.** The obvious "did it arrive?" test
is to fetch the touched pages before the merge and again after, and report that
something changed. Two things defeat it, and both are worth writing down so it
is not proposed again:

- **There is no pre-merge moment to fetch in.** Outcome verification is started
  by the founder, from a button, possibly hours after the merge. Capturing a
  baseline inside the merge operation would put an outbound request in front of
  a consequential write, for a signal the next point destroys anyway.
- **A page hash is not stable.** CSRF tokens, timestamps, session and analytics
  identifiers, A/B assignments and cache busters differ between two consecutive
  fetches of an unchanged page. "The content differs" would pass on a site
  nothing was deployed to, which is a false `verified` — the most damaging
  direction. Reading a hash equal would be equally weak in the other direction.

So the content comparison is not weakened here, it is absent. This profile does
not read a page's body at all, which is the boundary of what it may claim.

**Extracting expected strings from the diff.** Deterministic, and fragile:
JSX text is transformed, split, conditional and sometimes behind a flag. Its
false negatives would tell a founder their change did not arrive when it did.

**A generic "the site still responds" check.** Rejected for the reason the
original comment gave. It collects a green tick off the homepage for a change
that never touched it, and this profile refuses instead — see
`outcome_no_public_surface`.

## Decision

**`agentic_execution_v1` resolves to `agentic_public_routes_outcome_v1`, whose
expectations are the public routes the change touched, and whose single check
asks whether each is being served.**

One check kind, `public_route_serves_page`, whose whole meaning is one sentence:
*this path answered as a page, at the path Vibe asked for.*

```
2xx HTML at the requested path   → passed
2xx HTML somewhere else          → not_observed   a different page was served
404 / 410                        → not_observed   the page is not published
5xx, or served as not-a-page     → failed         the origin contradicts us
401 / 403 / 429 / transport      → error          Vibe could not look
```

The `error` row is where the discipline lives. A bot-blocking WAF and a rate
limiter answer 403 and 429 on a perfectly healthy page, and reporting either as
the customer's product being broken is the single most damaging thing this
module could say (ADR 0020 §19, §23). Only a 5xx — the server saying it is
broken — becomes `failed`.

### What `verified` means here, and what it does not

**It does not establish arrival.** A 200 is equally consistent with the previous
build still serving. Vibe reads no deployment API and has no provenance for
which build answered ([ADR 0020](0020-production-outcome-verification.md) §3,
§34), and this profile additionally holds no pre-merge copy of the page to
compare against.

The value is in the failure direction. The most expensive thing this pipeline
can do is merge a change that takes a public page to a 500, and until now the
agentic path answered that with `outcome_not_supported`.

That limit is written down in four places rather than remembered:
`OUTCOME_PROFILE_SCOPE_NOTES` states it in one sentence, `OutcomeCard.profileNote`
carries it as a field so a redesign cannot drop it, the panel renders it in
every state, and the check label says "answers" rather than "works", "is live"
or "updated".

### Refusals stay separated

A change with no public route is `outcome_no_public_surface`, not
`outcome_not_supported`. They are different sentences: the first says this
change has nothing public behind it, which is the ordinary shape of backend
work; the second says Vibe cannot verify this kind of change, which is no longer
true of agentic changes and would now be false.

### Bounds

`maxObservedRoutes: 4`, applied by the contract and re-applied at observation
time, so a stored expectation written under a larger budget cannot spend today's
requests. Dynamic routes are excluded: `/app/projects/[projectId]` is a template,
not a URL, and requesting it literally observes a 404 that would be reported as
the change having broken a page. Authenticated pages are never probed — an
anonymous GET of one observes the login screen.

Reaching the route budget marks the expectation `truncated` rather than silently
narrowing what was checked ([rule 27](../../CLAUDE.md)).

## Consequences

- The route table is now load-bearing for measurement as well as for review. A
  repository whose route analysis comes back `limited` or `none` resolves no
  public route and refuses; that is a coverage limit, reported as one.
- A changed layout, component or stylesheet serves no route of its own and
  resolves nothing. Under-claiming is deliberate: a verifier that inferred the
  affected pages would report on pages the change never touched.
- Two profiles now exist where the state copy is identical, which is why the
  profile note is a field on the card rather than a string in a component.
- `change_outcome_verifications.outcome_profile` gains a permitted value by
  migration. Stored rows keep the profile they were checked against.

## Alternatives left open

Arrival remains unverified, and closing it needs something this ADR does not
have: a signal about *which build* is serving. A deployment provider integration
would supply one — Vibe calls none today ([rule 74](../../CLAUDE.md)) — and that
is a different decision with its own permissions, its own failure modes and its
own ADR.

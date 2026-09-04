# 0045 - The project workspace is a command center, not an admin panel

Status: Accepted; the rail's membership amended again by [0084](0084-nova-is-the-project-home.md) — Home becomes Nova and Business Health returns as its own destination, restoring the seven this ADR chose

Date: 2026-08-23

## Context

The project workspace had eight sections: `Overview`, `Product`, `Business
score`, `Next moves`, `Prepared`, `Deep Scan`, `Impact`, `Activity`. Every one
of those names is an accurate description of what its route holds. Together they
describe Vibe's machinery rather than the customer's business.

Three specific consequences, none of which is a styling problem:

- **The landing screen answered the wrong question.** Overview was a provenance
  screen — which snapshots exist, when each was taken, how many of each artifact
  there are. That is worth knowing and it is not what a founder opening their
  own product wants first, which is where the product stands and what to do
  about it.
- **Configuration accumulated on the landing screen.** The production URL, the
  founder's own words about the business, and disconnecting the repository were
  all inline on the index page, because it was once the only page a project had
  and nothing moved them when the workspace split.
- **Two sections were destinations that should have been sources.** Deep Scan is
  something Vibe learns *from*; Activity is a log a person consults. Both sat in
  the rail at the same weight as the audit and the execution surface.

There is also a structural point the eight names obscured: the product already
has a durable model, written down in `PRODUCT.md` §11 — Understand → Diagnose →
Prioritize → Plan → Execute → Measure. The routes implemented that model
faithfully and named none of it.

## Decision

**Seven sections, named for the model the product already has**, with a Home
above it and a Settings beside it:

| Section | Segment | Model stage |
|---|---|---|
| Home | `""` | — the state, and the next move |
| My Product | `product` | Understand |
| Business Health | `health` | Diagnose |
| Action Plan | `plan` | Prioritize + Plan |
| Agent | `agent` | Execute |
| Experiments | `experiments` | Measure |
| Settings | `settings` | — |

Two routes are **subsections**: real routes, anchored and reachable, deliberately
absent from the rail. `product/deep-scan` is a source My Product learns from;
`settings/activity` is a log. They live in `PROJECT_SUBSECTIONS`, a separate
table from `PROJECT_SECTIONS`, so "what is in the navigation" and "what is a
route" are two questions with two answers and nothing has to remember to filter.

Three constraints bound the change:

1. **No section is lost.** The eight became seven plus two subsections; every
   panel, gate and read model behind them is unchanged. In particular the
   validation → preview → review → approval → merge lifecycle moved from
   `Prepared` to `Agent` and did not change in any other way.
2. **The `business-audit` section id does not move**, though its label and
   segment both do. `BUSINESS_AUDIT_ANCHOR` is the only way out of a blocked
   opportunity set, and the existing id/label/segment split exists precisely so
   the customer-facing halves can change without it.
3. **Nothing new is claimed.** Every value on every new surface comes from a
   read model that already existed. Where the brief for this work asked for
   something the domain cannot produce — a growth-experiment result, a
   pull-request button, a percentage on a business area — the surface says what
   is true instead, and a test pins it.

## Consequences

**Easier.** The navigation now teaches the model: a founder reading the rail
top to bottom reads the loop the product runs. New work has an obvious home —
anything about what the product *is* belongs to My Product, anything about
configuration to Settings — where before the answer was "Overview, probably".
Home has one job and can be judged against it.

**Harder.** Nine routes instead of eight, one of them nested two levels deep.
`workspace-routes.test.ts` had to learn to walk recursively, which it should
have done already; `agent-dogfood/[stepKey]` had never been covered by any of
its assertions.

**Foreclosed.** The label `Overview` is gone, and with it the habit of putting a
control on the index page because no other page obviously owns it. A future
section that is genuinely a source rather than a destination belongs in
`PROJECT_SUBSECTIONS`; adding it to the rail is now a visible decision rather
than the default.

**Not decided here.** Whether the seven are the right seven forever. This is an
information architecture, not a product scope change: no domain module, table,
provider or read model was added, so revisiting it costs a rename and a set of
route moves rather than a migration.

**Deliberately unresolved.** `Experiments` is named for what a founder means by
the word — we shipped this, did anything move — and not for what a statistician
means. This product runs no controlled experiments;
`src/modules/business-measurement/causality.ts` says so in code and is untouched.
The risk that the name invites a causal claim is real, and is answered by
running that module's own checker over the section's source rather than by
choosing a duller name.

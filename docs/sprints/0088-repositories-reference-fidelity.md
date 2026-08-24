# UI-10 — Repositories reference fidelity

## Outcome

`/app/repositories` follows the supplied SaaS reference as an honest repository command surface: route-level connect action, GitHub connection context, real account counts, a searchable and paginated repository ledger, and a concise explanation of how repository access is used.

## Deliberate differences from the reference

- No recent activity, branch total, pull-request total or “Active” status is shown because none is stored or cheaply verifiable by the current read model.
- Connection statistics are limited to connected repositories/products and stored visibility.
- The existing dark Vibe Business design system remains canonical; the reference supplies hierarchy and density, not a light-theme rebrand.

## Behavior

- Search matches repository, product and default branch.
- Visibility, sort and page are restorable URL parameters.
- The ledger shows five rows per page and clamps invalid pages after filtering.
- Desktop uses a semantic table; narrow screens retain every stored value in labeled record rows.
- Empty connection and no-results states are distinct.

## Verification

- Pure list-state tests cover search, filtering, sorting and pagination clamping.
- Browser fixtures cover hierarchy, absence of fabricated GitHub data, URL state, pagination, empty state and horizontal overflow at four viewports.
- The page keeps the existing two-query account repository read and adds one constant identity lookup; it makes no GitHub network call.

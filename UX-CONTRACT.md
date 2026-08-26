# UX Contract

## Product context

- Audience: independent founders and small product teams.
- Primary jobs: understand product health, choose the next business move, prepare and safely approve a change.
- Active locale: English product UI; deterministic machine timestamps render in UTC.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Product scope and approval | `PRODUCT.md` | Product contract | 2026-08-24 |
| Architecture and provider boundaries | `ARCHITECTURE.md` | Architecture contract | 2026-08-24 |
| Account/project context swap | `docs/decisions/0046-account-dashboard-and-context-swap.md` | ADR | 2026-08-24 |
| Project Home and Business Health | `docs/decisions/0047-business-health-is-project-home.md` | ADR | 2026-08-24 |
| Business Brain interaction and view model | `docs/decisions/0048-signature-business-brain.md` | ADR | 2026-08-24 |
| GitHub permissions and repository connection | `docs/decisions/0003-github-app-integration.md`, `docs/decisions/0009-github-installation-ownership-verification.md` | ADR | 2026-08-24 |
| Safe approved merge behavior | `docs/decisions/0018-human-approval-authority.md`, `docs/decisions/0019-safe-approved-change-merge.md` | ADR | 2026-08-24 |
| Billing | `PRODUCT.md#12-credit-model`, `docs/decisions/0024-billing-credit-ledger.md`, `docs/decisions/0025-billing-stripe-boundary.md` | Product contract + ADR | 2026-08-25 |

## Visual contract

- Project context: `DESIGN.md`.
- Token ownership: existing runtime tokens remain canonical.
- Runtime source: `src/app/globals.css`; shared owners live in `src/components/ui/` and `src/components/layout/`.
- Supported theme: dark product theme.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | Native select for short account index filters | `DESIGN.md`, this contract | native where platform popup geometry is accepted | keyboard + E2E |
| Scrollbar | Global application stylesheet | `DESIGN.md`, `src/app/globals.css` | geometry exceptions only | computed style/browser |
| Toast | Existing app notification owner when present | sibling workflow | success / warning / info / error | live-region test |
| CRUD | Domain service and route owner | `PRODUCT.md`, relevant ADR | return / stay per sibling workflow | full-flow E2E |

## Component behavior

| Component | Default | Hover | Focus | Disabled | Busy | Error |
|---|---|---|---|---|---|---|
| Button | shared contained owner | tokenized surface/accent change | global mint ring | visibly unavailable, no pointer action | stable geometry + `aria-busy` | local recovery |
| Search | committed URL query + explicit clear | shared interactive transition | global mint ring | n/a | retain dataset frame | no-results is distinct from failure |
| Table/list | comfortable density | row surface cue | controls receive visible focus | n/a | stable frame | persistent scoped state |
| Business Brain | staged but complete | real related paths and nodes gain emphasis | node uses the global mint ring | n/a | server lifecycle remains authoritative | existing notices and recovery |
| Product Scan | stored discoveries at first paint in reserved scanner/feed slots | grounded nodes and events gain emphasis without changing outer geometry | launcher uses shared button focus | unavailable without connected repository | stable launcher and scanner geometry + durable event feed | persistent partial/failure state + retry |
| Billing purchase / portal | real form posting an approved SKU or no client fields for portal | shared interactive transition | global mint ring | visibly unavailable with deployment explanation | stable label + `aria-busy`; duplicate submit blocked | persistent scoped notice with recovery copy |

## Dataset navigation

- Account product and repository indexes are comparison surfaces, not feeds.
- Committed search, filters, sort and page are URL state for repository tables. The input value is the committed query because filtering is local and does not dispatch remote work.
- Repository page size is five rows, matching the reference and bounding the visible ledger. The current read model returns the account's complete connected set in two constant-count queries; server pagination is deferred until the repository inventory contract exposes a paged read.
- Empty dataset, no-results and read failure remain distinct. No-results offers clear/reset and restores focus to search.
- Back/Forward restores committed query/filter/sort/page through URL parameters.
- No row selection or bulk action exists in V0.1.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|
| Connect repository | Primary connect link | owned onboarding flow | product onboarding/workspace | onboarding-owned error state | flow-owned | `PRODUCT.md`, ADR 0009 |
| Search/filter/sort | Account index controls | local, no loader | same route and URL state | clear/reset | clear returns focus to search | this contract |
| Open repository | repository link | browser navigation | GitHub in a new tab | browser-owned | browser-owned | stored `html_url` |
| Open product | row action/product link | route navigation | owning product workspace | app route error | destination heading | ADR 0042 |
| Run Product Scan | onboarding live-site confirmation or My Product launcher | one durable operation; individual stored findings; no percentage | product reveal in onboarding / refreshed My Product dossier | source failures remain visible; retry only when operation policy allows | refreshed Product Profile heading | ADR 0052 |
| Correct product understanding | `Let me fix it` | stable inline editor and busy save action | same Product page | inline persistent error | corrected profile summary | Product Understanding contract |
| Switch product | project switcher option | route navigation | selected product Home | current product + `View all products` remain available | destination page heading | ADR 0050 |
| Buy Credit pack | `Buy` beside an approved pack | stable busy action; pessimistic redirect | Stripe Checkout, then Billing return | persistent action error; cancelled return confirms no charge | Checkout/browser owned | ADR 0025 |
| Start paid plan | `Choose {plan}` | stable busy action; pessimistic redirect | Stripe Checkout, then Billing return | persistent action error; cancelled return confirms no charge | Checkout/browser owned | ADR 0025 |
| Manage or cancel subscription | `Manage or cancel plan` | stable busy action | Stripe customer portal | persistent action error | portal/browser owned | ADR 0025 |
| Claim Welcome Credits | `Add my 100 Welcome Credits` | stable busy action | same Billing page with canonical balance | persistent action error | submitted action remains contextual | ADR 0024 |
| Confirm founder action | `Confirm this is complete` on the current founder-owned action | stable busy action; duplicate submission blocked | same Action Plan with evidence-derived next step | persistent inline error; criterion remains visible | submitted action remains contextual | ADR 0055 |

## Navigation and responsive behavior

- Every route has a truthful metadata title.
- Account sidebar becomes the established top strip below `lg`; project and account rails never nest.
- On desktop, the project rail owns product identity, the bounded product switcher, project navigation and the account disclosure for the full viewport height. The project document scrolls independently; there is no sticky content header.
- Project routes render `My Products / {product}` followed by one route-owned H1, description and action. Repository, branch and connection metadata do not repeat above every page.
- `Project Settings` is a project destination. Profile, Account settings, Billing and Sign out live only in the account disclosure at the rail footer.
- Project Home is the canonical Business Health surface at `/app/projects/:projectId`; `/health` is a compatibility alias and is never a second rail item.
- `#business-audit` remains the stable recovery anchor and resolves on canonical project Home.
- The radial Business Brain becomes a horizontally browsable dimension rail plus the same detail panel on narrow screens. Labels, health, priority, selection and detail remain available; geometry is never the only interface.
- Repository comparison uses a semantic table at desktop and labeled record rows on narrow screens. Identity, product, visibility, default branch, connected time and open action remain available.
- Technical values truncate only where their full value is also available through the external repository link or the mobile full-name row.
- The Product page keeps one-column reading order below `lg`; its Product DNA and source grids collapse without hiding confidence wording, founder intent, brand evidence or source availability.
- The Product page ends at the profile confirmation. It does not repeat raw code/live summaries or append a Business Health action below that decision boundary.
- Product Scan uses one shared component in onboarding and My Product. Its desktop scanner, summary, activity and 3×2 discovery regions reserve their geometry before findings arrive. Below `md`, the constellation becomes a linear facet rail; discoveries remain ordered and fully readable.
- On My Product, Product Scan remains expanded while working, folds automatically after the stored completion event, and can be opened again to review discoveries or start a re-scan. Onboarding and failure states remain expanded. The toggle exposes its expanded state and controlled region to assistive technology.
- Billing uses three equal overview panels at desktop, then asymmetric content/support grids. Below `lg`, every region returns to document order without hiding plan status, expiry, purchase actions or signed Credit movement. No Billing panel owns a viewport height or nested scroll area.

## Async and resilience

- Index reads are server-owned. Failures reach the account route error boundary; the UI does not imply an empty dataset.
- Search and sorting are local over the loaded account inventory, so no stale request or spinner exists.
- GitHub live status is not fetched on the index. Stored connection metadata is labeled honestly and revalidation stays at the consequential workflow that needs it.
- Product Scan polls canonical Supabase operation state and at most 24 ordered events every 2.5 seconds. It refreshes server content only on a terminal transition. A public-product failure degrades to partial when another source remains usable; it never removes a successful source reading.
- Billing reads remain server-owned and never move money or Credits. Checkout and portal mutations are pessimistic, block duplicate submission and report persistent local errors. A Checkout return says only that payment confirmation is pending; Credits appear only after the signed Stripe webhook updates canonical state.

## Motion and sensory behavior

- Business Brain entry motion is staged through Motion for React: low-opacity network, centre, nine nodes, real relationships, then the default decision panel.
- After entrance, a very slow centre breath and at most one low-opacity signal path may continue. They pause while the document is hidden and never imply a new scan or live recalculation.
- Hover and keyboard focus emphasize only real related paths and nodes. Selection uses one continuous layout/presence transition and replaces the default right panel with the selected area rather than appending a report below the map.
- Reduced-motion mode removes reveal delays, signal movement, pulse and map repositioning while preserving every node, relationship meaning, score and action at first paint.
- Motion never implies live activity, a recalculation or a score change.
- Product Scan motion is event-driven through Motion for React. A newly observed stored event may produce one bounded core impulse and one feed entrance; events present at first paint do not replay or announce as new.
- Product Scan's slow orbital movement runs only while the operation is active and the document is visible. Reduced motion removes the orbit, impulse and transforms while preserving every status and finding.
- Product Scan events for a logo, typeface, color and other grounded facets populate existing slots. Arrival may animate opacity, a short transform or a connector, but never parent size or document flow.

## Verification

- Static: lint, typecheck, unit tests, strict premium audit.
- Browser: repository success, empty, no-results, search clear, filter, sort, pagination, URL restoration and 1440/1024/768/375 widths; Business Health reading order, map interaction, canonical recovery link, responsive transformation and reduced motion.
- Canonical sibling: `/app/products` and the account shell.
- Repository evidence: `e2e/account-repositories.spec.ts`, `e2e/business-audit.spec.ts`, `e2e/action-plan-ui.spec.ts`, `e2e/product-scan.spec.ts`, `e2e/billing.spec.ts`.

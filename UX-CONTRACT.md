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
| Account/project context swap | `docs/decisions/0042-account-dashboard-and-context-swap.md` | ADR | 2026-08-24 |
| GitHub permissions and repository connection | `docs/decisions/0003-github-app-integration.md`, `docs/decisions/0009-github-installation-ownership-verification.md` | ADR | 2026-08-24 |
| Safe approved merge behavior | `docs/decisions/0018-human-approval-authority.md`, `docs/decisions/0019-safe-approved-change-merge.md` | ADR | 2026-08-24 |
| Billing | `PRODUCT.md#12-credit-model` | Product contract | 2026-08-24 |

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

## Navigation and responsive behavior

- Every route has a truthful metadata title.
- Account sidebar becomes the established top strip below `lg`; project and account rails never nest.
- Repository comparison uses a semantic table at desktop and labeled record rows on narrow screens. Identity, product, visibility, default branch, connected time and open action remain available.
- Technical values truncate only where their full value is also available through the external repository link or the mobile full-name row.

## Async and resilience

- Index reads are server-owned. Failures reach the account route error boundary; the UI does not imply an empty dataset.
- Search and sorting are local over the loaded account inventory, so no stale request or spinner exists.
- GitHub live status is not fetched on the index. Stored connection metadata is labeled honestly and revalidation stays at the consequential workflow that needs it.

## Verification

- Static: lint, typecheck, unit tests, strict premium audit.
- Browser: repository success, empty, no-results, search clear, filter, sort, pagination, URL restoration and 1440/1024/768/375 widths.
- Canonical sibling: `/app/products` and the account shell.
- Repository evidence: `e2e/account-repositories.spec.ts`.

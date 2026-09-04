# 0084 - Nova is the project Home

Status: Accepted

Date: 2026-09-03

Amends [ADR 0045](0045-command-center-information-architecture.md) and reverses the navigation half of [ADR 0047](0047-business-health-is-project-home.md). Records the decision that closes §D.6 of [the Nova architecture audit](../audits/2026-09-03-nova-architecture-audit/README.md) — the founder's §O.2 amendment. Changes no domain module, no persistence, no provider, no audit contract and no paid operation; the same sentence 0047 ended on, and true here for the same reason.

## Context

ADR 0047 made Business Health the canonical project Home and removed it from the rail, on the argument that a project's most valuable answer should not be one navigation step away. That argument was right about the diagnosis and is untouched: the audit is still the only surface that brings the score, the lenses, the priorities and their evidence together, and it is still the most valuable thing Vibe knows about a business.

What changed is that the diagnosis stopped being the last thing Vibe does with it. The product now plans a Move, builds it in a sandbox, prepares a change, has a person approve one exact commit, and fast-forwards a default branch to it. A founder opening a project is no longer asking "how is my business doing" — they asked that once. They are asking *"what do I do now"*, and a screen whose answer is a score plus nine lenses answers a question they already have the answer to.

The Nova audit's §D.6 left this open deliberately: whether Nova is a seventh rail item or the Home itself. Both were arguable while Nova was a proposal. Neither is arguable once you write down what a seventh rail item means — a founder arriving at a project would be asked, in the first second, *which of seven places do I go*. That is the question Nova exists to remove, and a product that removes it everywhere except its own front door has not removed it.

## Decision

**Home is Nova.** `/app/projects/:projectId` renders what needs the founder's attention now, one control for it, what is running, and what else is true — `deriveNovaFocus`'s `primary`, `nextAction`, `working` and `secondary`, rendered by `src/components/nova/`.

**Business Health returns to the rail with a real segment.** The rail becomes: Home (Nova) · My Product · Business Health · Action Plan · Agent · Experiments · Settings. Seven destinations again, which is the count ADR 0045 chose and 0047 reduced — but the seventh is not a new place, it is the one 0047 folded into Home coming back out of it.

**Three bindings move, all in `src/components/layout/project-shell.tsx`:**

- `PROJECT_SECTIONS[0]` becomes Nova; a Business Health entry returns with a segment of its own.
- `WORKSPACE_SECTION_HEADINGS` gives Home Nova's heading, and the Business Health heading moves with its route.
- **`#business-audit` keeps resolving.** `projectSectionHref(projectId, "business-audit")` is the only way out of a blocked opportunity set (`src/modules/opportunities/view.ts:33-53`), so it points at wherever Business Health lands, and `/health` stays an alias. ADR 0047 kept the section id stable through a label and segment change precisely so this could happen without a migration; that affordance is now being spent, and it was worth keeping.

**Every non-Nova section becomes a drill-down from something Nova said.** The rail stops being a menu of seven equal places and becomes the set of rooms behind one answer. Nothing is removed, and nothing that exists today becomes unreachable.

**Onboarding keeps its focused shell.** `/app/onboarding/:projectId` renders no rail at all, unchanged: a rail beside a setup flow is an invitation to abandon it ([ADR 0023](0023-project-scoped-onboarding-orchestration.md)).

## Consequences

**Easier.** The first screen of a project answers the question a founder actually arrives with, and answers it with one control rather than seven doors. The ranking behind it is already built and tested (`deriveNovaFocus`), so Home stops being a hand-composed summary and becomes a render of a derivation — which is also what makes it testable without a browser.

**Harder.** Two ADRs now disagree about what Home is, and only the dates tell you which won. That is the cost of reversing a decision in the open rather than by drift, and it is the smaller cost: 0047's reasoning is still worth reading, because the half of it about the audit's value is still true and still constrains what may sit on the audit's own route.

**Compatibility.** `#business-audit` and `/health` both keep resolving, so no stored URL and no domain identifier needs a migration — the same guarantee 0047 gave, kept for the same recovery path.

**What this does not decide.** Whether the account dashboard changes. It does not: `attention.ts` already ranks across projects and Nova ranks within one, and §D.6 was a question about the project surface alone.

**Foreclosed.** A seventh rail item for Nova, now or later. If Nova is worth a place in the rail she is worth the first one, and if she is not she should not be in the product — the middle option is the one that re-asks the question. Also foreclosed: a project Home that becomes a generic KPI summary. 0047's last consequence still binds, and Nova is not an exemption from it — what Home shows must be what needs attention now, derived, with a control on it.

## Status of the code

The decision is recorded here with the sprint that landed Slices 2 and 3, as §O.2 requires — ahead of the rail change itself, which lands with the slice that renders the focus on Home (§L Slices 5–7). `PROJECT_SECTIONS[0]` is still Business Health at HEAD, and this ADR is why it will not stay that way.

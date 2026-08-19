# Vibe Business — Product UI/UX Audit

**Date:** 2026-08-17 · **Repository state:** `main` @ `0d33ae2` · **Method & limits:** see [Appendix](#appendix--method--evidence)

**The question this audit answers:** *Does Vibe Business already feel like a simple, premium, trustworthy product that helps a non-technical AI builder turn what they built into a business?*

**The one-sentence answer:** The intelligence surfaces already feel premium and genuinely differentiated, and the safety machinery is honest to a degree few products match — but the experience currently breaks in three places: a front door that argues against entering, a diagnosis→action seam that was never built, and an execution flow that renders the product's biggest moments as an undesigned wall of pipeline text.

---

## Contents

1. [Executive Assessment](#1-executive-assessment)
2. [Product Experience Scorecard](#2-product-experience-scorecard)
3. [Core Journey Map](#3-core-journey-map)
4. [Top Findings](#4-top-findings)
5. [Systemic UI Debt](#5-systemic-ui-debt)
6. [Screen-by-Screen Audit](#6-screen-by-screen-audit)
7. [What to Remove or Hide](#7-what-to-remove-or-hide)
8. [What Is Missing](#8-what-is-missing)
9. [Visual Design Direction](#9-visual-design-direction)
10. [Prioritized Roadmap](#10-prioritized-roadmap)
11. [Implementation Sprints](#11-implementation-sprints)
12. [Quick Wins](#12-quick-wins)
13. [Do Not Touch Yet](#13-do-not-touch-yet)
14. [Launch Readiness](#14-launch-readiness)
15. [The Product Test](#15-the-product-test)
— [Appendix — Method & Evidence](#appendix--method--evidence)

---

# 1. Executive Assessment

## How mature does Vibe currently feel?

Two products live in this codebase. The **intelligence tier** — business audit, product understanding, the reveal moments, auth — feels like a late-beta product with a real point of view: a conclusion-first verdict ("You have a real product that people can use, but nothing about it explains how anyone would pay you"), a distinctive business map, honest waiting states that refuse fake progress bars, and the best empty-state writing this audit has seen in a while. The **execution tier** — the prepared-change flow from validation through merge, which is the product's entire differentiating thesis — feels like an engineer's status page: eight equal-weight text sections under a Git branch name, three visually identical buttons, and a confirm dialog in a blue that exists nowhere in the design system. The machinery underneath that tier is *more* mature than the intelligence tier (the approval/merge safety model is genuinely excellent); only its clothing is missing.

## Does it look like a launch-ready SaaS?

Not yet — and the gap is narrow and concentrated, not diffuse. The blockers are enumerable: a landing page that literally tells visitors the product is not built; no privacy/terms anywhere while asking for a codebase; an onboarding path that can trap a pre-launch founder in a room with no exit; navigation that gives zero feedback while the render path makes up to four GitHub round-trips; and an execution surface that contradicts itself ("Not merged" three times on a merged change). None of these is a redesign; all of them are sprints.

## Developer tool or business product?

The headline layer is a business product — arguably the best-translated one in this category ("Show Vibe what you built", "People still don't have a clear way to pay you", "Waiting for you"). One level down, the developer tool shows through: branch names as card titles, evidence IDs rendered as prose ("Signal pricing surface"), "the core loop described in PRODUCT.md", "For development. No elaborate onboarding." on the signup screen, "VIBE NEEDS U" as a section label. The product has a voice; it doesn't yet hold it below the first paragraph.

## Top 5 problems

1. **The loop's connective tissue is missing.** The audit ranks problems; the moves page ranks solutions in a different vocabulary; the database already links every move to the audit conclusion it addresses (`sourceConclusionKey`) and the UI never renders it. The flagship screen's dominant affordance ("START HERE") is inert, the real handoff is a small text link, and a freshly prepared change never links onward to the Prepared page. Every stage is good; the seams between stages are unbuilt.
2. **The execution surface reads as CI and contradicts itself at the trust peak.** The change card narrates pipeline order (branch → validation → preview → review → approval → merge), buries "What Vibe changed / Why this matters" below the merge button, keeps stale per-gate disclaimers alive ("Not merged · Not deployed" on a merged, production-verified change), leaves the biggest success as a small mint sentence, and strands users at the two most common non-happy states (drift-blocked merge, unobserved outcome) with no next action.
3. **Every workspace click is a silent wait.** There is no `loading.tsx`, no navigation pending state, and both layout and page block on a fresh GitHub token mint + repository listing before anything paints. The best waiting screen in the product (the audit constellation) is unreachable from the very button that starts the audit. The stack itself is measurably fast (5–20 ms TTFB in fixture mode) — the slowness is serial I/O plus zero feedback.
4. **The front door argues against entering.** The landing page's only body paragraph says the core loop "is not built yet" (no longer true), the hero CTA routes to Sign in rather than Sign up, there is no product proof, and no legal pages exist for a product requesting repository access.
5. **The design system exists but is unapplied where it matters.** ~1,500 lines of excellent, philosophy-documented primitives against ~11,500 lines of page code that mostly bypasses them: three parallel button systems, seven competing status→color maps ("failed" is coral on one panel, amber on the next), two typographic scales, no Dialog/Spinner/Skeleton primitives at all — and the product-wide label color fails WCAG AA contrast.

## Top 5 strengths

1. **The audit verdict and business map.** Conclusion-first, judgment-bearing, visually distinctive — the product's identity in one screen, with a mobile fallback (grouped priority list) that is better responsive thinking than most production apps.
2. **The honest language system.** Centralized, human status labels ("Ready for Vibe", "Waiting for you", ~30 prose operation stages), waiting states that say what's happening and that you can leave, and empty states that teach the next action.
3. **The trust machinery's copy.** The merge dialog shows exact from→to commits, promises to stop on drift, refuses deployment claims, and warns the user's own CI/CD may react — before the click. Error maps never blame the user and never leak provider internals.
4. **Responsive and accessibility foundations.** Zero horizontal overflow across every rendered page at 390 px; real buttons over decorative SVG; a global focus ring and reduced-motion kill-switch; color never carries meaning alone.
5. **The token layer.** The near-black/mint/mono visual language is coherent, on-audience, and fully specified — the foundation to finish, not to replace.

## The single highest-leverage improvement

**Give every screen in the core loop exactly one primary next action, and wire those actions into an unbroken chain.** Concretely: the audit's #1 priority card carries a real primary button into the moves that address it (the linkage already exists in data); each move leads to preparation; a prepared change leads to the Prepared page; the change card leads with its meaning and derives one current-gate primary action ("Review", "Approve", "Merge") instead of eight equal panels. This one principle — applied with the pill `Button` primitive that already exists — simultaneously resolves the top comprehension problem, the top execution problem, and the top visual-hierarchy problem.

---

# 2. Product Experience Scorecard

Diagnostic scores, 1–10. No total is computed — the profile matters, not the average.

| Dimension | Score | Why |
|---|---|---|
| Product comprehension | **6** | Headline layer is excellent everywhere; comprehension degrades one level down (evidence IDs, unexplained "43 READINESS", duplicate map badges, two prioritization vocabularies). |
| First-time experience | **4** | Well-designed onboarding machine undermined by frozen progress copy, a silent failure reset, a no-live-site trap with no exit, and a landing page that argues against signup. |
| Navigation / IA | **5** | Clean 8-section workspace and honest breadcrumb; but zero navigation feedback, no sign-out from the workspace, triple naming for one section (id `business-audit`, label "Business score", heading "Business audit"), and no per-change detail route. |
| Business audit UX | **8** | The product's best surface: verdict-first, map + priorities + evidence, honest lifecycle. Loses points for the inert "START HERE", the notice stack, and the unexplained score number. |
| Opportunity UX | **5** | Ranked and honest, but five same-weight chips per card, a retired taxonomy resurfacing (dimension chips), no rendered link to the audit conclusion each move addresses, and a dead-end no-moves state. |
| Execution UX | **4** | World-class machinery presented as a pipeline log: branch-name titles, stale disclaimers, no current-gate emphasis, stranded drift/outcome states, no onward links. |
| Review / Approval UX | **5** | Approval binding to an exact commit is exemplary and the dialog copy is excellent; but rationale sits below the decision, invisible changes (robots/sitemap) produce identical before/afters with no explanation, confirms are false modals that drop keyboard focus, and approvals stay revocable after merge. |
| Trust | **7** | The honesty discipline is the brand and mostly lands (read-back verification, refusal to claim deployment). Docked for self-contradicting stale disclaimers, a broken logo image atop "I understand what you built.", and the absence of any privacy/terms. |
| Visual quality | **6** | The designed tier (audit, auth, understanding) is an 8–9; the execution tier is a 3; averaged experience is a split product. |
| Design consistency | **4** | Three button systems, seven status→color maps, three glyph vocabularies, two type scales, 33 container widths, five dead shared components. |
| Mobile | **6** | Zero overflow, excellent map fallback, adequate review strategy; docked for ~135 px sticky header + affordance-less nav strip on phones, unusable Deep Scan sign-in, and latent long-string overflow on real file paths. |
| Accessibility | **6** | Strong base (focus ring, reduced motion, semantics, keyboard-operable map) with concentrated failures exactly at the consequential step: false `aria-modal`, focus dropped to body on confirm, 13 of 15 silent error sites, and an AA contrast failure on the product-wide label color. |
| Perceived performance | **4** | Measurably fast stack; experientially slow product — silent navigation, 20–90 s synchronous waits behind button labels, the flagship loading state unreachable, one polling loop re-rendering the heaviest route every 2.5 s. |
| Launch readiness | **4** | See [Section 14](#14-launch-readiness): NO for paid traffic today; YES after an enumerable set of fixes. |

---

# 3. Core Journey Map

| Stage | Current UX | Main friction | Recommended direction |
|---|---|---|---|
| **Landing** | One hero, no proof, empty footer. Copy says the core loop "is not built yet" and cites `PRODUCT.md`. | The page self-disqualifies the product and pattern-matches to abandonware; hero CTA goes to Sign in. | Rewrite around the loop that now exists: honest early-access qualifier, three-step "how it works", one real audit visual, both CTAs → `/signup`, minimal footer links. |
| **Auth** | Polished split-shell login/signup with trust bullets; best-in-class error copy. | Signup lacks Google (login has it), shows "For development. No elaborate onboarding.", and a lost confirmation email is a permanent wall (no resend). | Add Google to signup, remove dev copy, add resend-confirmation, keep everything else. |
| **Connect** | Guided GitHub App flow with account/repo pickers. | GitHub-App jargon ("installation… suspended or revoked"), no preparation for GitHub's own consent screen, onboarding rail wraps non-onboarding connects with no exit. | One sentence before handoff ("GitHub will ask which repository Vibe may read — read-only"); translate errors; pass `canLeave` for veterans. |
| **Product understood** | "I understand what you built." + one-paragraph summary + Did-I-get-this-right confirmation — a real wow-moment attempt. | Broken logo image can sit directly above the claim; "Likely, based on several signals" ×7; six identical stacked cards; confirmation is skippable by the bottom CTA. | Logo error fallback; state the qualifier once; tighten card hierarchy; make the bottom CTA acknowledge unconfirmed state. |
| **Audit** | Verdict → map + priorities → lens detail → what's working. Honest preparing/analyzing states. | "START HERE" is inert; score number unexplained; notice stack above the verdict; the analyzing state never appears when you click Run. | Make priority #1 the primary action; explain or remove the map's number; collapse notices; wire the button to the lifecycle state. |
| **Opportunity** | Ranked move cards with problem statements and "Why now?" disclosure. | Five equal chips per card; retired dimension taxonomy; no rendered link to the audit conclusion; readiness vocabulary ("Not automated yet") does the right thing but sits among noise. | Strip chips to readiness (+ impact at most); badge each move with the audit priority it addresses; keep rank order as the one ranking. |
| **Execution** | Prepare → validation with live phases → preview → review → approve → merge, all on one stacked card. | Pipeline order, branch-name identity, stale disclaimers, no single current action, freshly prepared changes don't link onward. | Chain-aware card: rationale-first title, one derived current-gate primary action, settled gates collapsed to status rows. |
| **Review** | Before/after screenshots + "A comparison is evidence, not a verdict". | The flagship SEO change is invisible — two identical screenshots read as "it did nothing"; capture polls by re-rendering the whole route. | Explain expected-invisible changes and lead with the diff link; poll a cheap status action. |
| **Apply** | Approval bound to an exact commit; merge dialog with from→to and CI/CD warning; fast-forward or refuse. | Confirms are false modals that drop focus; drift-blocked state has no next step; merge button is visually tertiary; sky-blue one-off styling. | Real dialog primitive; mint primary for the one consequential action; name the drift recovery path. |
| **Verified** | Read-back verification, 7 concrete outcome checks, delivery/product/business ladder. | Success renders as small mint text under stale "Not merged" disclaimers; `not_observed`/`failed` offer no re-check, ever. | Card-level success state led by the ladder; "Check again" on unobserved/failed outcomes. |

---

# 4. Top Findings

Ordered by product impact, not severity alone. IDs reference the specialist finding they consolidate; every finding cites rendered evidence (`screenshots/…`) or `file:line`.

| # | Severity | Finding |
|---|---|---|
| **F-1** | P1 | **The diagnosis→action seam is unbuilt.** Audit priorities and moves are two uncoordinated rankings in two vocabularies; the join key (`sourceConclusionKey`, `src/modules/opportunities/schema.ts:124`) is stored, validated, and rendered nowhere. "START HERE" — the flagship's dominant affordance — only re-selects the already-selected lens with no scroll (inert; `current-priorities.tsx:148–176`, `audit-intelligence.tsx:60–65`); the real handoff is a small underlined link. In the no-moves state even that disappears (`audit-synthesis-no-moves@1440.png`). *Direction:* render the lineage; make priority #1 carry a primary-weight action into the moves that cite it. |
| **F-2** | P1 | **Stale disclaimers make the trust surface self-contradicting.** A merged, production-verified change still displays "Not merged · Not deployed · Not reviewed by a human", "Not approved · Not merged", and "Nothing has been merged or deployed." (`outcome_verified@1440.png`; `validation-panel.tsx:228–234`, `review-panel.tsx:56–62`, `approval-panel.tsx:52–56`). Three false statements at the moment of maximal trust. *Direction:* derive each gate's "not yet" line from the furthest gate actually reached; let the delivery ladder be the single "what hasn't happened" surface. |
| **F-3** | P1 | **The change card narrates the pipeline, not the work.** Card identity is `vibe/seo-foundations-cc32273131c5` + SHA; "What Vibe changed / Why this matters" renders below the Merge button (`merge_ready@1440.png`; `prepared-changes-section.tsx:132–242`). Users are asked to approve before the page says what the change is for. ~58 renderable states stack ~1,900 px per change, all gates permanently expanded, no detail route. *Direction:* rationale-first title, one emphasized current gate, settled gates collapsed to status rows. |
| **F-4** | P0 | **Onboarding can trap a pre-launch founder.** The live-site step blesses "I don't have a live site yet" ("That is useful context." — `live-site-step.tsx:100–102`), then the audit hard-requires a live URL with no skip (`audit-live-prerequisite.tsx:26–46`); with `canLeave=false` the takeover shell has no exit and `/app` redirects back in (`onboarding-shell.tsx:17,49`, `app/page.tsx:102–105`). Sign-out is the only door. *Direction:* honor the choice — let the founder finish onboarding with the audit honestly parked, or say up front that a live site is required. |
| **F-5** | P1 | **Landing page argues against entry.** Body copy: the core loop "is not built yet", citing `PRODUCT.md` (`src/app/page.tsx:21–26`) — no longer true per the product's own fixtures; no proof, no steps, no legal, empty footer; hero "Get started" → `/login` while nav "Get started" → `/signup` (`landing@1440.png`). *Direction:* rewrite around the existing loop; one product visual; unify CTAs → `/signup`. |
| **F-6** | P1 | **Every workspace navigation is a dead screen.** Zero `loading.tsx`/`error.tsx`/`not-found.tsx` in the app; nav active state changes only after the destination renders (`project-nav.tsx:30–39`); layout *and* page each block on a fresh GitHub token mint + repo listing per click (`workspace-context.ts:69`, `repositories.ts:52–55`), the prepared page adds sequential per-change assembly + merge preflight (`workspace.ts:130–305`). Fixture floor proves the stack is fast (TTFB 5–20 ms); the wait is serial I/O with no feedback. *Direction:* per-section `loading.tsx`, probe out of the blocking path, optimistic nav state. |
| **F-7** | P1 | **Consequential confirms are false modals that lose the keyboard.** Approve/Revoke/Merge/Preview confirmations are inline blocks with `role="dialog" aria-modal="true"`, no focus management: verified live, after Enter on "Merge approved change" `document.activeElement === body` and the user re-tabs from the top (`approval-panel.tsx:71–74,125–128`, `merge-panel.tsx:73–76`, `preview-panel.tsx:105–108`). 13 of 15 async error sites in the chain have no `role="alert"`; a screen-reader user who merges hears nothing. *Direction:* one shared ConfirmDialog + announcement layer. |
| **F-8** | P1 | **No action hierarchy at the decision points.** "Merge approved change" — the product's most consequential action — is a square outline button pixel-identical to "Validate again" and "Revoke approval" (`merge_ready@1440.png`); the mint primary `Button` is used zero times in the execution flow; the audit's primary path is a 10.5 px mono label + text link. The system's own rule ("one primary per screen area", `button.tsx:4–16`) is unenforced. *Direction:* consolidate onto `Button` variants; exactly one mint primary per screen. |
| **F-9** | P1 | **Product-wide label contrast fails WCAG AA.** `--color-fg-meta` (#6e6a63) computes 3.70:1 on the app ground, 3.38–3.45:1 on raised surfaces — below 4.5:1 — and is the *default* color of `MonoLabel` (60 uses + 83 raw `text-fg-meta`) at the product's smallest sizes, including every section eyebrow, breadcrumb, and timestamp (`globals.css:52`, `typography.tsx:36`). *Direction:* one-token fix to ≥ 4.5:1. |
| **F-10** | P1 | **Onboarding's waits are frozen, its failures silent.** Stage copy never advances during the run (refresh fires only when polling *stops* — `operation-watcher.tsx:22–24`); a stalled run shows "taking longer than expected" above "Vibe will keep going" with no retry; a failed audit silently resets to the start button as if nothing happened (`operations/store.ts:86`, `onboarding/[projectId]/page.tsx:229–233`) — the workspace's excellent failure-message map is never imported here. *Direction:* wire stage refresh, add stalled/failed branches with the existing copy system. |
| **F-11** | P2 | **Drift and unobserved outcomes are dead ends.** Both merge-drift states end with "Review the updated repository state before merging." — no link, no recovery path, and the blocked variant says "Vibe did not modify the repository" twice (`merge_blocked_repository_changed@1440.png`, `merge/messages.ts:30–31`). Outcome `not_observed`/`failed` (a 15-minute window easily missed by slow builds) never offers "Check again" (`outcome-panel.tsx:210–232`). *Direction:* name the recovery path; add a re-check for the free, read-only outcome probe. |
| **F-12** | P2 | **The success moment is thrown away.** Merged + production-verified — the product's entire promise, delivered — renders as two `text-sm` mint sentences at the bottom of ~1,700 px of settled pipeline detail, visually equal to "Preview stopped" (`outcome_verified@1440.png`). *Direction:* card-level success state led by the delivery ladder; this is elevation and ordering, not new claims. |
| **F-13** | P2 | **The broken-logo hero.** The understanding hero renders a raw `<img>` of the customer's logo with no error branch; on failure the browser's broken-image glyph sits directly above "I understand what you built." (`understanding_ready@1440.png` — reproduced; `understanding-panel.tsx:67–77`). The partial state already has the graceful sentence; the happy path doesn't use it. *Direction:* onError fallback to the mark + existing note. |
| **F-14** | P2 | **The evidence layer ships its plumbing.** Opened disclosures render machine IDs as prose — "Signal pricing surface", "Payments none", "Journey checkout not found" (`audit-synthesis--expanded@1440.png`; `evidence-labels.ts:34–37,72` humanize() fallback); meta-commentary addresses the builder ("The order is the engine's, and it is shown as produced", `moves/page.tsx:113`); internal register leaks: "For development. No elaborate onboarding." (`signup/page.tsx:34`), "the onboarding lifecycle stays independent of the provider" (`onboarding/[projectId]/page.tsx:100`), "VIBE NEEDS U" (`needs-user-panel.tsx:89`, `audit-lifecycle.tsx:208`). *Direction:* one copy rule — every sentence meaningful to a founder who never opened the repo — applied to the layer below the headlines. |
| **F-15** | P2 | **Deep Scan runs ~90 s synchronously behind "Working…".** The one operation that isn't durable (`deep-scan-actions.ts:97–115`, `maxDuration=120`) follows the user's highest-effort act (signing in inside an embedded browser); feedback is a disabled button label in a modal that also lacks a focus trap and is unusable at 390 px (iframe scales to ~28%). *Direction:* durable operation or staged in-dialog progress; on phones, offer "continue on desktop". |
| **F-16** | P2 | **Run-audit never shows the running audit.** Clicking "Run business audit" changes only small header text; the built preparing/analyzing constellation appears only on reload because the start action doesn't revalidate (`run-audit-action.ts:53–60`, `score/page.tsx:173–179`) — meanwhile the stale verdict displays as current for ~50 s. Review capture, conversely, refreshes the entire heaviest route every 2.5 s (`review-panel.tsx:143–155`). *Direction:* refresh into the lifecycle state on start; poll a cheap status action during capture. |
| **F-17** | P2 | **Status colors disagree about bad news.** "Failed" is coral in validation, amber in outcome and impact; "degraded" (bad) renders the same amber as "waiting" (neutral); seven local maps, three glyph vocabularies (`validation-panel.tsx:55–60`, `outcome-panel.tsx:45–57`, `business-impact-panel.tsx:72–77`); `StatusPill`, built for exactly this, has 4 uses. *Direction:* one shared severity→tone map + glyph set. |
| **F-18** | P2 | **Score-page notice stack buries the verdict.** Up to three status boxes render above "What Vibe thinks", including a *permanent* "Authenticated product evidence — Ready" row that appears on every visit forever once a deep scan exists (`score/page.tsx:205–253`, `audit-evidence-notice.tsx:14–21`). *Direction:* suppress the no-news state; collapse coexisting notices; reserve the space above the verdict for the paused question only. |
| **F-19** | P2 | **The map's central number and badges are unexplained.** "43 READINESS" has no scale or direction on the map (the "/100" exists only in the legacy meta line); duplicate "1" badges on three nodes encode priority membership but the legend never says so (`audit-synthesis@1440.png`; `business-map.tsx:259–267,468–484,515–545`). *Direction:* gloss or remove the number; add the badge to the legend. |
| **F-20** | P2 | **Invisible changes review as "nothing happened".** The flagship robots/sitemap capability produces pixel-identical before/afters, and the review panel has no expected-invisible concept (`review-panel.tsx:184–247`). *Direction:* declare non-visual changes at the comparison and lead with the diff link. |
| **F-21** | P2 | **No privacy, terms, or legal surface anywhere** — for a product collecting credentials and reading customer repositories (`marketing-shell.tsx:58–63`; no legal routes exist). *Direction:* minimal privacy/terms linked from footer and signup. |
| **F-22** | P2 | **Signup is the high-friction path.** No Google on signup (login has it), no resend-confirmation anywhere — a lost verification email is a permanent wall (`signup-form.tsx`, `modules/auth/actions.ts`); a second `<h1>` and dev-facing sub-copy round it out. *Direction:* Google on signup, resend action from the login error state. |
| **F-23** | P2 | **Workspace chrome on phones spends ~16% of the viewport.** Sticky ~135 px header + non-sticky, affordance-less 8-item horizontal nav strip (later items invisible off-strip; source-audited — `project-shell.tsx:104–110,163`, `project-nav.tsx:42`); prepared cards are ~2,300 px of sequential gates at 390 px with no in-page orientation. *Direction:* one-line mobile header, end-fade on the strip, per-change gate summary. |
| **F-24** | P3 | **Approval stays revocable after merge** with no consumed state (`approvals/view.ts:30–40`, `approval-panel.tsx:256–263`) — revoking an already-merged approval does nothing explicable. *Direction:* render post-merge approval as a historical record. |
| **F-25** | P3 | **Perpetual decorative motion on the flagship.** Node halos breathe (3.6 s), the radial sweep rotates (5.5 s), lines flow — indefinitely, communicating nothing that isn't static (`globals.css:212–259`). Reduced-motion users are protected; everyone else pays battery and attention continuously. *Direction:* settle after a few cycles; pause off-screen. |

---
# 5. Systemic UI Debt

The component *design* is not the debt — the primitives in `src/components/ui/` are well-reasoned and documented. The debt is **adoption**: ~1,479 lines of shared components against ~11,471 lines of page code written around them. Sprints 0022–0031 shipped domain-correct UI faster than the system was applied to it; the panels of `src/app/app/projects/[projectId]/` (~6,600 lines, 41 files) are where almost all of it concentrates.

Ranked by breadth of payoff:

| # | Root problem | Evidence | Screens affected | Systemic fix |
|---|---|---|---|---|
| 1 | **Three parallel button systems.** 38 `<Button>` vs 42 raw `<button>`; the string `rounded-md border border-line-4 px-3 py-1.5…` repeated ~15× across 7 panel files; ~8 underlined text-link actions; mint primary absent from the entire execution flow; "START HERE" is a label, not a button. | `merge-panel.tsx:112,229`, `approval-panel.tsx` ×7, `preview-panel.tsx` ×6, `validation-panel.tsx` ×3, `review-panel.tsx` ×3, `current-priorities.tsx:148` | Every execution state (~20 captured screens), audit synthesis, repository intelligence, needs-user | Consolidate onto `Button` variants with an enforced one-mint-primary-per-screen rule. Single biggest visible improvement available. |
| 2 | **No status layer.** Seven local status→color maps disagree (failed = coral or amber; degraded = the waiting color); three glyph vocabularies (`✓ ✕ ⏱ –` / `✓ ✕ – !` / `✓ ~ —`); `StatusPill` (5 tones, correct "unknown ≠ bad" doc) used 4×. Labels, by contrast, are centralized and good. | `validation-panel.tsx:45–60`, `outcome-panel.tsx:45–57`, `business-impact-panel.tsx:72–77`, `intelligence-summary.tsx:42–55`, `attention-list.tsx:25`, `project-list.tsx:30` | All pipeline panels, activity, dashboard, intelligence | One shared severity→tone map + `StatusGlyph`, consumed everywhere; delete the seven locals. |
| 3 | **Missing primitives: Dialog, Busy, Skeleton, announcements.** Confirmation exists as `window.confirm` (disconnect), inline false modals (approve/revoke/merge/preview), and one bespoke incomplete modal (deep-scan). Loading exists as 29 hand-written "…ing" button labels; zero spinners/skeletons/`<Suspense>`; one `aria-live` region in the app. | `approval-panel.tsx:70–74`, `merge-panel.tsx:72–76`, `deep-scan-panel.tsx:102–198`, `disconnect-button.tsx` | Every async flow (12 `useTransition` files), every confirmation | Build ConfirmDialog (focus trap/restore/Escape) + PendingButton/Busy with built-in live-region semantics; route all confirms and error sites through them. |
| 4 | **The client never got the operation abstraction the server has.** Eight panels hand-roll poll+pending+refresh with four different intervals, no backoff, no visibility pause; one refreshes the heaviest route every 2.5 s; completion refresh rides on a stale `revalidatePath` target; the analyzing state is unreachable from its own start button. | `review-panel.tsx:143–155`, `preview-panel.tsx:55,239–256`, `run-audit-action.ts:53–96`, `outcome-panel.tsx:186` | All polling panels, score page, moves page | One `useOperationPoll` hook + `<OperationStatus>` consuming the existing `OperationView`/stage labels; owns interval, backoff, visibility, completion refresh, announcements. |
| 5 | **Navigation has no loading model.** Zero `loading.tsx`/`error.tsx`/`not-found.tsx`; GitHub installation probe (token mint + repo listing) in both layout and page of every workspace render; sequential per-change assembly on `/prepared`; N+1 loops on `/moves` and summaries. | `workspace-context.ts:69`, `repositories.ts:52–55`, `workspace.ts:130–305`, `moves/page.tsx:60–105` | Every workspace navigation | Per-section `loading.tsx` skeletons; probe cached/demoted out of the blocking path; `Promise.all` the assemblies. |
| 6 | **Two typographic scales.** Token scale used 21× vs `text-sm` ×311 + ~90 arbitrary sizes (many numerically duplicating tokens); `h3` spans six sizes; on the change card ~14 text blocks compete at one optical size. `SectionHeader` and `MonoValue`, built to fix this, are dead code. | `typography.tsx:72`, `deep-scan-panel.tsx:89` vs `lens-detail.tsx:59`, `audit-overview.tsx:44` | Execution flow, deep-scan, overview, lens detail | Revive `SectionHeader`; map panel headings/body/meta to the six tokens; ban arbitrary sizes in review. |
| 7 | **One token undermines the whole ramp.** `--color-fg-meta` fails AA at every size it's used, and it's the default for the brand's signature eyebrow style (60 `MonoLabel` + 83 raw uses). Also: `text-danger` references a token that doesn't exist (error renders unstyled). | `globals.css:52`, `typography.tsx:36`, `founder-intent-form.tsx:160` | Every screen | Raise fg-meta ≥ 4.5:1 (one line); add the missing danger text mapping (`text-coral`). |
| 8 | **Surface/radius/container drift.** 60 ad-hoc `rounded+border` rectangles vs 39 `Surface` uses; `rounded-md` (not a token) ×47 vs 16 total uses of the five designed radius tokens; 33 distinct `max-w-*` values; shells disagree (70/76/80 rem); duplicated input styling (two local reimplementations of `inputClassName`); `Metric` shadowed by a local namesake; `scoreDisplay` duplicated. | `prepare-change-panel.tsx:52`, `approval-panel.tsx:74,128`, `founder-intent-form.tsx:39`, `production-url-form.tsx:72`, `project-list.tsx:30` | App-wide | Surface-adoption pass; radius and container constants owned by shells; delete dead components (`ScoreMeter`†, `VibePanel`, `PageShell`) or adopt them deliberately. († `ScoreMeter` is the right fix for the barren legacy-audit state before deletion is considered.) |
| 9 | **Focus-ring knowledge doesn't propagate.** `button.tsx` documents excluding `outline-color` from transitions so the ring appears instantly; ~17 ad-hoc controls use plain `transition-colors` and their ring fades in (verified live); the app-shell logo removes its ring entirely. | `button.tsx:35–38`, `current-priorities.tsx:104`, `disclosure.tsx:41`, `field.tsx:19`, `app-shell.tsx:40` | All non-`Button` interactive elements | Shared focus-safe transition utility; sweep `transition-colors` on focusables. |

---

# 6. Screen-by-Screen Audit

Proportionate to journey importance. **[R]** = rendered and screenshotted; **[S]** = audited from source only (no fixture exists).

### Landing `/` [R]
One hero on a grid-glow ground. The typography and mint treatment are genuinely premium; the content is the problem: self-negating copy, no proof, no steps, no footer links, split "Get started" destinations (F-5). At 390 px it holds up cleanly. *This page is the cheapest large win in the product.*

### Login / Signup / Forgot / Reset [R]
The strongest conventionally-designed screens in the app: split shell, headline reprise, trust bullets ("Read-only access to start"), exactly one glowing primary each, excellent error-message architecture (`modules/auth/errors.ts` — classified, enumeration-safe, per-screen overrides). Defects: signup's missing Google + dev sub-copy + no resend path (F-22); decorative second `<h1>` per page; reset-password's expired-link state redirects sensibly to forgot-password with an honest notice [R — captured].

### Onboarding `/app/onboarding[/projectId]` [S]
The best-conceived flow in the product on paper: mandatory takeover, four phases, resumable state derivation, honest waiting copy, telemetry. The realization has the journey's worst defects: frozen stage copy during runs, no stalled/failed branches (silent reset on audit failure), the no-live-site trap (F-4), guard mismatches rendering blank content areas, and "Go to dashboard" routing to the workspace instead. The product-reveal confirmation ("Did Vibe get this right?" → "Looks right" / "Something's off") is exactly right and should be protected through any rework.

### GitHub connect `/app/connect/github/*` [S]
Good structure (account chooser → repo picker → callback verification), three distinct honest empty/blocked states. GitHub-App jargon one level down, no preparation for GitHub's own consent screen, and the onboarding rail wraps veteran connects with no exit (`canLeave` never passed).

### Dashboard `/app` [S]
The attention model (Blocked / Waiting for you / Ready / Setup, max 4, one contextual CTA per project row) is the right IA and the computed headline ("Nothing needs your attention.") is the right voice. Empty state teaches the next action well. Concerns: no loading boundary (post-login dead moment), `scoreDisplay` re-hardcoded locally, and the workspace it links into provides no way back to account actions (no sign-out in `ProjectShell`).

### Project Overview `/app/projects/[id]` [S]
Sensible summary tiles + context grid + inline forms. Dense but coherent. Notable: `window.confirm` for disconnect (the only native dialog in the product), founder-intent form's invisible error (`text-danger`), and the page carries the section-naming drift (nav "Business score" → heading "Business audit" → id `business-audit`).

### Product `/understanding` [R]
The wow-moment attempt mostly lands: hero claim + summary + confirmation buttons, then structured sections with a clean forward CTA into the audit. Defects ranked: broken-logo hero (F-13), "Likely, based on several signals" ×7 (F-14), label duplication ("WHO IT'S FOR" eyebrow above "Who it's for" field labels), six identical surfaces at equal weight, unconfirmed-state CTA conflict (bottom "Run my business audit" ignores the unanswered "Did I get this right?"), and the partial state asking for confirmation of an absent claim under a slug-cased title ("shifts").

### Business score `/score` [R]
The flagship, and it deserves the name: verdict-first, the map, priorities, lens detail, "What's already working". Ranked defects: inert "START HERE" + text-link handoff (F-1), notice stack incl. the permanent "Ready" row (F-18), unexplained "43 READINESS" + unexplained duplicate badges (F-19), unreachable lifecycle state on Run (F-16), lens-detail label soup (nine mono eyebrows around four sentences), legacy pre-map audits rendering as a near-empty page with jargon meta ("5 of 5 areas scored") [R — `audit-complete@1440.png`]. The preparing/analyzing/waiting states are excellent; "VIBE NEEDS U" mars the waiting header.

### Next moves `/moves` [S]
Honest ranked list, good readiness gating ("Not automated yet" cards get no button — correct). Defects: five equal chips per card (F-1/F-14), retired dimension taxonomy resurfacing, meta-commentary description, dead-end empty state when the audit has priorities but no moves exist yet, and no onward link from a completed preparation (the user must discover "Prepared" in the nav).

### Prepared `/prepared` [R]
The product's differentiator and its weakest screen. All findings F-2/F-3/F-8/F-11/F-12/F-17/F-20/F-24 live here, plus: heading structure gives SR users no way to tell which change owns which Approval panel (unlabeled `<li>`, h4 under h2); duplicated status summary well at card bottom; sky-blue one-off dialog; UTC-only timestamps; "artifact"/"policy" vocabulary in user copy; "Validate again" as the most prominent enabled action on finished changes. The underlying state presentation is impeccably honest — this screen needs design, not re-engineering.

### Deep Scan `/deep-scan` [R partial]
Clear pitch and honest free-scan framing ("Your first Deep Scan is included"), disabled "Coming with Vibe Credits" for repeats (correctly not a checkout). Defects: the ~90 s synchronous analyze behind "Working…" (F-15), incomplete modal focus handling, phone-unusable embedded browser with only a caveat sentence, `maxDuration=120` as the only safety net.

### Impact `/impact` [R states]
The delivery/product/business ladder is a real invention and the refusal to fake causation ("what Vibe refuses to claim it caused") is on-brand. The universal `source_required` state is correctly demoted to one quiet line. Defects: outcome dead ends (F-11), amber "failed" (F-17), "not observed" repeated up to nine times on one card, failed checks rendered as bare crossed expectations ("✕ /signup excluded from sitemap" — is that the wish or the result?).

### Activity `/activity` [S]
Honest append-only feed with facts. Fine as-is; pagination is stated but not implemented ("Older entries exist beyond the N shown here.").

### Error / 404 surfaces [S]
The only boundary in the app is `global-error.tsx` rendering Next's default light-themed "Application error" — off-brand at the worst possible moment. Every `notFound()` (bad project id, revoked repo access mid-flow) renders Next's unstyled 404 outside any shell. No route-level `error.tsx` exists to catch the GitHub/data failures the render paths can throw.

---
# 7. What to Remove or Hide

The goal is subtraction. Each item names where it goes, not just that it goes.

**Remove outright**
- The permanent "Authenticated product evidence — Ready" notice (`audit-evidence-notice.tsx:14–21`) — the absence of news is not a notice.
- Stale per-gate disclaimers once superseded ("Not merged · Not deployed" on merged cards) — the delivery ladder is the single honest surface for "what hasn't happened" (F-2).
- The duplicated status-summary well at the bottom of the change card — it restates statuses shown centimeters above.
- "Revoke approval" after merge (F-24) — replace with the historical record.
- The inert "START HERE" label (F-1) — replaced by a real action, not merely deleted.
- The second `<h1>` on each auth page; the "For development. No elaborate onboarding." sub-copy; the `PRODUCT.md` reference on the landing page.
- The sky-blue one-off styling (replaced by tokens, F-8/VIS-3).
- Duplicate "Vibe did not modify the repository" in the blocked-merge state.

**Hide behind progressive disclosure** (trust-critical stays inline: approval-bound commit, merge from→to→read-back, branch link)
- Validation phase durations, "Checked under earlier rules" policy nuance, artifact reuse notes → `TechnicalDetails` (the primitive exists and is unused in all eight panels).
- Changed-file path lists on the card header → a compact "2 files" disclosure.
- Effort/confidence chips on move cards → inside "Why now?"; the legacy dimension chip → replaced by the audit-conclusion badge (F-1).
- Evidence-ID rows ("Signal pricing surface") → curated sentence labels, with the raw ID behind the disclosure.
- Per-check "not observed" repetition → one grouped statement.
- Meta-commentary ("The order is the engine's…", "No supporting evidence was lost…") → deleted or refocused on the reader.

**Demote**
- The map's central "43 READINESS" number → either glossed ("43 of 100 — early") or moved off the map to where it is explained (F-19).
- "Validate again" on finished changes → tertiary, so a redundant re-run is never the most prominent action.
- The per-row "Likely, based on several signals" ×7 → one section-level qualifier.

# 8. What Is Missing

Only additions with a named user problem:

1. **The handoff chain** (F-1): audit priority → its moves → preparation → the Prepared page → the change's current gate. Every link exists in data; none exists in UI.
2. **A success moment** (F-12): merged + verified is the promise delivered; it currently whispers.
3. **Navigation feedback** (F-6): per-section `loading.tsx`; an error boundary and branded 404 inside the shells.
4. **Recovery actions** (F-11): drift-blocked merge names its path; unobserved/failed outcomes get "Check again".
5. **Legal surface** (F-21): privacy + terms, linked from footer and signup.
6. **Verification-email recovery** (F-22): resend action; Google on signup.
7. **An exit from the trap** (F-4): the no-live-site founder finishes onboarding with the audit honestly parked.
8. **Onboarding failure states** (F-10): the failure-message map exists; onboarding never imports it.
9. **A logo fallback** (F-13): one `onError` branch protecting the product's most important sentence.
10. **Dialog + announcement primitives** (F-7): the missing foundation under five hand-rolled confirms and 13 silent error sites.
11. **Sign-out from the workspace**: the 8 project routes render no account chrome at all.
12. **A per-change gate summary on mobile** (F-23): "Validated ✓ · Previewed ✓ · Waiting for approval" that jumps to panels.

# 9. Visual Design Direction

**Verdict: refine, don't rebrand.** The foundation — near-black ground, four white-alpha surfaces, one mint accent that means "Vibe acts", Space Grotesk for human judgment, JetBrains Mono strictly for machine evidence — is distinctive, on-audience, and fully specified in `globals.css`. Where it is applied (audit, auth, understanding) the product looks premium and unlike generic AI-SaaS. A rebrand would discard the only finished asset this codebase has.

**Mood:** calm terminal intelligence. The product should feel like a precise instrument that speaks plainly — not a dashboard, not a chatbot, not a DevOps console.

**The rules that finish the system** (each is an existing token/primitive, enforced rather than invented):

- **Hierarchy:** one mint primary action per screen; `SectionHeader` for every panel heading; the six type tokens replace `text-sm`-for-everything; headline (sans, bold) → explanation (prose ramp) → machine detail (mono, small, *readable* — fg-meta raised to AA).
- **Surfaces:** the four levels used as designed — section > panel > well; ad-hoc bordered rectangles converted or deleted; card-in-card only where the inner element is genuinely a well.
- **Status:** one severity→tone map (mint = good/active, amber = waiting/attention, coral = failed/destructive, neutral = unknown — *never* amber for bad news), one glyph set, `StatusPill` as the only pill.
- **The execution flow joins the brand:** the change card becomes a stage timeline with one emphasized current gate — the same conclusion-first grammar as the audit ("What Vibe changed" as the headline, machinery below). This is the single largest visual payoff available.
- **Buttons:** pills only; square-outline raws retired; text-links reserved for genuine tertiary navigation.
- **Motion:** the audit constellation and map sweep are the brand's motion budget — let them settle after a few cycles, pause off-screen, and add nothing else beyond micro-transitions on `--ease-vibe`.
- **Celebration, Vibe-style:** no confetti — elevation. Success = the delivery ladder promoted to the top of the card, mint-tinted surface, headline-weight verdict sentence. Honesty *is* the celebration.

# 10. Prioritized Roadmap

**P0 — comprehension / broken core journey** (impact: existential · effort: S–M · deps: none)
- F-4 onboarding trap exit · F-10 onboarding failure/stall states · F-5 landing rewrite · F-21 legal pages · F-13 logo fallback.

**P1 — core workflow simplification** (impact: the product's promise · effort: M–L · deps: none technical; sequence after P0 for attention)
- F-1 audit→moves lineage + real primary handoff · F-3/F-2/F-12 chain-aware change card (rationale-first, stale disclaimers derived away, success elevated) · F-8 one-primary-per-screen button consolidation · F-11 recovery actions · F-16 run-audit lifecycle wiring · F-6 navigation loading model.

**P2 — design system / systemic consistency** (impact: every screen · effort: M · deps: benefits from landing after P1's card rework to style the final structure)
- Debt items #2 status layer, #3 Dialog/Busy primitives (fixes F-7), #6 typography normalization, #7 fg-meta + danger tokens, #8 surface/container pass, #4 `useOperationPoll`.

**P3 — responsive / accessibility / interaction** (impact: correctness at the edges · effort: S–M · deps: #3's Dialog primitive)
- F-23 mobile chrome budget + gate summary · F-15 deep-scan progress + phone strategy · RAM-4 heading structure on prepared · RAM-7 long-string wrapping · focus-transition sweep · branded error/404 boundaries.

**P4 — premium polish / motion** (impact: delight · effort: S)
- F-25 motion settling · map badge/number gloss beyond the P1 fix · `ScoreMeter` for legacy audits · timestamp localization · evidence-label curation beyond the top IDs.

# 11. Implementation Sprints

Derived from the findings, not from the audit brief's examples. Six sprints, each shippable alone, ordered so trust and comprehension land first.

**Sprint 1 — Honest Front Door** *(Goal: no user is repelled or trapped before the product can speak.)*
Why now: cheapest existential fixes; everything downstream is wasted on users who never arrive or never escape onboarding.
Scope: landing rewrite around the existing loop (hero, three steps, one audit visual, unified `/signup` CTAs, footer links); privacy/terms pages; signup parity (Google, resend confirmation, copy); onboarding integrity (no-live-site path honored, stalled/failed branches using the existing message maps, live stage refresh, "Go to dashboard" accuracy); connect-flow translation + `canLeave`.
Areas: `src/app/page.tsx`, marketing shell, auth forms/actions, `src/app/app/onboarding/`, connect pages.
User-visible result: a stranger can understand, join, and finish onboarding without a dead end.
Risk: low — additive copy/routing; the onboarding state machine itself is untouched. Dependencies: none.

**Sprint 2 — One Loop, One Story** *(Goal: the user always knows the next move, and it's one click.)*
Why now: the diagnosis→action seam is the product's core promise and its data already exists.
Scope: render `sourceConclusionKey` lineage (moves badged with the audit conclusion they address); priority-#1 card carries a primary-weight action into its moves; no-moves state links to generation; move-card chip diet (readiness + impact; effort/confidence into "Why now?"; dimension chip retired); prepared-completion links onward to Prepared; run-audit start enters the lifecycle state.
Areas: `current-priorities.tsx`, `audit-intelligence.tsx`, `opportunities-panel.tsx`, `moves/page.tsx`, `prepare-change-panel.tsx`, `run-audit-action.ts`.
User-visible result: audit → "See what Vibe would do about this" → move → prepared change, without hunting.
Risk: low-medium — read-model plumbing for the lineage badge. Dependencies: none.

**Sprint 3 — The Change Card Becomes Vibe's Proudest Screen** *(Goal: execution reads as finished work, not CI.)*
Why now: the differentiator currently undoes the trust the machinery earns; this is the largest single perception change available.
Scope: chain-aware card headline state derived in `getPreparedChangeWorkspace` (rationale-first title; branch/SHA to a details row); stage timeline with one emphasized current gate and one mint primary; settled gates collapse to status rows; stale disclaimers derived from furthest-gate-reached (F-2); success state led by the delivery ladder; drift recovery path named; outcome "Check again"; post-merge approval as record; invisible-change explanation in review; "artifact/policy" vocabulary translated; sky styling retired.
Areas: `prepared-changes-section.tsx`, all eight panels, `workspace.ts`, `merge/messages.ts`.
User-visible result: "Vibe did the work — here's where it stands, here's the one button" — and success finally looks like success.
Risk: medium — the largest UI rework; mitigated by fixtures + existing e2e specs covering these exact states. Dependencies: Sprint 5's Dialog primitive helps but isn't required (confirms can land in either order).

**Sprint 4 — Never a Dead Screen** *(Goal: every wait is visible, every failure is caught.)*
Why now: the app is fast but feels broken on every click; these are harness-level fixes with app-wide payoff.
Scope: per-section `loading.tsx` skeletons; GitHub installation probe cached/demoted out of the blocking render path; parallelized prepared/moves assembly; review capture polling via cheap status action; `useOperationPoll` + `<OperationStatus>` (interval/backoff/visibility/completion-refresh/announcement in one place); deep-scan staged progress (or durable operation); branded `error.tsx`/`not-found.tsx`/`global-error`.
Areas: workspace routes, `workspace-context.ts`, `workspace.ts`, polling panels, `deep-scan-actions.ts`.
User-visible result: clicks respond instantly with honest skeletons; the analyzing screen appears when analysis runs; failures land on a Vibe-branded page with a way forward.
Risk: medium — touches data-fetch paths; behavior covered by existing unit suite. Dependencies: none.

**Sprint 5 — One Design System, Applied** *(Goal: the system that exists becomes the system in use.)*
Why now: after Sprints 2–3 settle structure, consolidation locks it in and stops the drift recurring.
Scope: button consolidation (all raws → `Button`; one-primary rule); status layer (severity→tone map + `StatusGlyph` + `StatusPill` adoption); ConfirmDialog + announcement layer (replaces `window.confirm`, inline false modals, deep-scan modal; fixes focus loss + silent outcomes); typography normalization (`SectionHeader` revival, token mapping, arbitrary-size ban); fg-meta + danger tokens; surface/radius/container pass; focus-transition sweep; dead-component cleanup.
Areas: `src/components/ui/`, all panels, `globals.css`.
User-visible result: one product visually; "failed" means one color everywhere; keyboard and screen-reader users survive the merge button.
Risk: low-medium — mechanical but broad; fixture screenshots enable before/after verification per state. Dependencies: Sprints 2–3 (style the final structure, not the current one).

**Sprint 6 — Evidence, Voice & Reward** *(Goal: the layer below the headlines earns the same trust as the headlines.)*
Why now: polish that compounds after structure is right; also contains the mobile product decisions.
Scope: evidence-label curation (top ID families → sentences; humanize() as monitored last resort); copy register pass ("Vibe needs you", meta-commentary removal, third-person voice rule, "This is where I'd start" fix); map decode fixes (badge legend, score gloss, within-ring ordering); label-soup diet on lens detail/understanding; understanding CTA-conflict fix; mobile chrome budget (one-line header, strip affordance, gate summary); deep-scan phone strategy; motion settling; timestamp localization; `ScoreMeter` for legacy audits.
Areas: audit components, understanding panel, `project-shell.tsx`, copy across panels.
User-visible result: digging deeper rewards trust instead of exposing machinery; phones get first-class chrome.
Risk: low. Dependencies: Sprint 5's status/typography primitives.

# 12. Quick Wins

Ten highest value-to-effort changes, independent of the sprint structure. None requires design work.

1. **Raise `--color-fg-meta` to ≥ 4.5:1** — one token; repairs AA contrast on every screen (F-9).
2. **"Vibe needs u" → "Vibe needs you"** — two characters; two files (F-14).
3. **Logo `onError` fallback** on the understanding hero — one branch; protects the product's most important sentence (F-13).
4. **Point both "Get started" CTAs at `/signup`** (F-5, partial).
5. **Delete the permanent "Ready" deep-scan notice** (F-18, partial).
6. **`text-danger` → `text-coral`** in founder-intent-form — makes the save error visible (debt #7).
7. **Link the no-moves audit sentence to the Moves page** (F-1, partial).
8. **Revalidate the score route on audit start** — the analyzing state becomes reachable (F-16).
9. **De-duplicate the blocked-merge sentence** and suppress "Not merged · Not deployed" lines on merged cards (F-2, partial — full derivation lands in Sprint 3).
10. **Retire the sky palette** in merge dialog + validation active phase for existing tokens (F-8, partial).

# 13. Do Not Touch Yet

Protecting what works is half this audit's value:

- **The business map's desktop radial form.** Fix the two decode failures (badge legend, score gloss); do not redesign the map. It is the product's identity image, its a11y architecture is exemplary, and its mobile fallback proves the information survives without it.
- **The audit's reading order** (verdict → map+priorities → lens detail → what's working). It is correct. Change what's *around* it (notices, handoff), not the spine.
- **The auth screens' layout and error architecture.** Best-in-class; additions only (Google, resend).
- **The token palette and surface model** (except the fg-meta value). The dark-only decision is coherent for this audience; do not spend effort on a light theme now.
- **The status *label* vocabulary in domain modules** (`EXECUTION_READINESS_LABELS`, `OPERATION_STAGE_LABELS`, measurement ladder). The words are right; only their styling fragments.
- **The onboarding state machine and phase structure.** Fix its surfacing (F-4, F-10); keep its derivation-from-canonical-records design — it's why resume works.
- **The empty-state copy system.** "State the situation, then give exactly one way forward" is already house style. Extend it; don't rewrite it.
- **The approval/merge safety semantics** (immutable binding, fast-forward-or-refuse, read-back verification) and their dialog copy. This audit proposes re-clothing them, never relaxing them.
- **The validation panel's live phase display** (real seconds, real phases). Restyle within the new card grammar; keep the honesty.
- **Deep Scan's entitlement framing** ("first scan included", typed refusal, no fake checkout). Correct product behavior; only its waiting/phone UX needs work.

# 14. Launch Readiness

**Would I put paid traffic on Vibe Business today? NO — but the distance is short, and the verdict flips to YES after a specific, bounded list.**

Why not today: the landing page tells paid visitors the product isn't built (F-5) — that alone voids ad spend; there is no privacy/terms surface while requesting repository access (F-21); a pre-launch founder (a large share of the Lovable/Bolt audience) can be trapped in onboarding (F-4) or watch it silently reset on failure (F-10); and the first minutes inside the app are silent waits (F-6, F-16) ending, for the successful few, in an execution surface that contradicts itself at the moment of trust (F-2).

**Minimum conditions for paid acquisition** (≈ Sprint 1 + the trust-critical third of Sprints 2–4, plus Quick Wins):

1. Landing page describes the product that exists; CTAs unified; legal pages linked (F-5, F-21).
2. Onboarding cannot trap or silently fail (F-4, F-10).
3. Workspace navigation shows loading feedback; run-audit shows the running audit (F-6, F-16).
4. The audit hands off to moves with one obvious action (F-1 at minimum severity: the link works and is visible).
5. No false statements on the change card (F-2), and one visually primary action per execution screen (F-8 minimum).
6. The contrast token fix (F-9) and the confirm-focus fix (F-7 minimum: focus moves into the confirm block).

Not launch-blocking (deliberately): the full change-card redesign, the status-layer consolidation, mobile chrome budget, evidence-label curation, motion polish — these determine how *good* the product feels, not whether paid traffic is wasted.

# 15. The Product Test

*A 22-year-old built an app with Lovable, has never run a business, and connects it to Vibe. Within 10 minutes:*

**Do they understand what Vibe found?** Yes — this is the product's greatest strength. "You have a real product that people can use, but nothing about it explains how anyone would pay you" requires zero translation. The map's NOW/SOON/LATER grouping and "What's already working" land. (Caveats: the unexplained 43, and only if onboarding's waits didn't lose them first — F-10.)

**Do they know what to do next?** Partially, and this is the sharpest gap. They know what's *wrong*. The screen's strongest affordance does nothing (F-1), the real path is a small link, and if they reach the moves page they meet a second ranking in a different vocabulary with five ratings per card. The knowledge is one rendered join away.

**Do they trust Vibe to help?** Mostly yes inside the app — "read-only to start", "nothing merged without your approval", the paused audit that asks before spending, and the merge dialog's precision all land even for a novice. The trust leaks are at the edges: a landing page that undermines itself, no privacy policy anywhere, a possible broken-image hero, and — if they get far enough — a merged change that still says "Not merged".

**Can Vibe do meaningful work for them?** Yes — genuinely. Prepared changes with isolated branches, real validation, preview, and safe merge is work no advice-tool does. But the *feeling* of receiving that work is missing: what they see is a pipeline monitor with a branch name on top, and their biggest win renders as one small mint sentence.

**Does the interface make them feel smarter or more overwhelmed?** Smarter on the intelligence surfaces — the audit teaches business thinking in the user's own product, which is quietly the best thing about Vibe. More overwhelmed on the execution surfaces, where eight equal panels, ~58 possible states, SHAs, and self-contradicting disclaimers ask them to do the work of a release manager.

**Net:** the 10-minute experience today earns the verdict *"this thing understands my product and business better than I do — but I'm not always sure what it wants me to do, and the part where it works for me looks like a terminal."* Every element of the better verdict — *"it understands, it tells me what to do, it does it, and I saw it land"* — already exists in the codebase. The work is connection and clothing, not construction.

---

# Appendix — Method & Evidence

## How this audit was performed

1. **Repository analysis.** Full route inventory, design-token and component survey, status-language mapping, polling/data-flow tracing, sprint-history review (`docs/sprints/0000`–`0031`).
2. **Rendered application.** The app was built (`pnpm build`) and served in the repository's own end-to-end fixture mode — `VIBE_E2E_FIXTURES=1` with the Playwright config's non-resolving placeholder Supabase host, making contact with real backends structurally impossible. Nothing was mutated: no database, no GitHub, no AI calls, no source changes.
3. **Screenshots.** 90 full-page captures across 1440 / 1280 / 768 / 390 px using the repository's own `playwright-core` against Chromium, covering all 5 public pages and all 34 fixture scenarios, plus interaction states (merge confirm open, disclosures expanded) and browser-console capture. This directly fills the gap sprint `0028` recorded: "Browser screenshots at 1440, 1280, tablet and 375px still need to be captured against a running app."
4. **Specialist passes.** Six coordinated specialist audits (first-time journey & copy; core intelligence UX; execution & trust UX; visual design & design system; responsive/accessibility/motion; perceived performance & frontend architecture), reconciled by a lead into this single report. Contradictions were resolved, not concatenated — e.g., the a11y pass's "strongest area of the frontend" verdict on responsiveness coexists with, and bounds, the visual pass's "two products" critique.
5. **Live checks.** A systematic horizontal-overflow scan at 390 px across all rendered pages (result: zero overflow), live keyboard-focus walks (verifying focus loss on the merge confirm), and render-timing measurement (TTFB/FCP floors on the fixture server).

## What was rendered vs. audited from source

**Rendered and screenshotted** (fixture scenarios use the real production components with realistic data): landing, login, signup, forgot-password, reset-password (captured in its expired-link state); business audit `audit-synthesis` (+ no-moves), `audit-complete`, `audit-partial`, `audit-uncertain`, lifecycle (`audit-preparing`/`analyzing`/`waiting`), three `needs_user` interrupts; product understanding ready/confirmed/partial (+ expanded); repository intelligence ×3; prepared-change lifecycle — merge ×4 (incl. open dialog), production outcome ×6, business impact ×7.

**Not renderable (no fixtures exist) — audited from source only, and labeled as such wherever cited:** the `/app` dashboard, the onboarding flow (all 9 states), the GitHub connect pages, the project workspace chrome (`project-shell.tsx` — fixture pages render panels *without* this shell), the Deep Scan live sign-in view, the review panel's with-images state (every fixture renders its images-unavailable branch), and multi-change stacking on `/prepared`.

No visual claim is made about screens that were not rendered; findings there cite `file:line`, not screenshots.

## Evidence index

- Screenshots: `screenshots/` alongside this document (`{slug}@{width}.png`; `--dialog` / `--expanded` = post-interaction).
- Browser console: the only errors across all captures were failed loads of a remote customer-logo URL on the understanding scenarios (see F-13) — no application errors.
- Measured floors (fixture server, production build): TTFB 5–20 ms, FCP 88–156 ms, full load < 200 ms, ~170–240 KB JS transferred. The stack is fast; production slowness comes from serial I/O in render paths (F-6, Section 5 #5).
- File references are repo-relative; panel files live in `src/app/app/projects/[projectId]/`, primitives in `src/components/ui/`, tokens in `src/app/globals.css`.

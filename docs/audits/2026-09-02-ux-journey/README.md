# Vibe Business — UX journey audit, signed-out surfaces and rendered panels

**Date:** 2026-09-02 · **Repository state:** `main` @ `9755be1` · **Method & limits:** see [Appendix](#appendix--method-and-what-it-cannot-see)

**The question asked:** *walk the product as a customer — connect, onboard, run the agent — and write down what is missing, what the UI does not do, and what a customer would want and not find.*

**The honest answer to that question first:** the walk could not be taken. Every `/app/*` route redirects to `/login` without a real session, and this environment's network policy refuses outbound connections to the deployed site. What this audit covers is **67 rendered surfaces** — the six public pages and 61 fixture scenarios — captured at 1440 px and 390 px. It says nothing about navigation between them, and the seams are where the [2026-08-17 audit](../2026-08-17-product-ux-audit/README.md) found its three worst problems.

**What it found:** three defects worth fixing, two of them contract violations. And four findings that dissolved on checking, which is reported here at equal length, because the method that produced them is the method a next audit will reuse.

---

## 1. What has demonstrably improved since 2026-08-17

The prior audit's top three problems were a front door that argued against entering, an unbuilt diagnosis→action seam, and an execution surface that contradicted itself at the trust peak. Two are closed and the third is much reduced.

**The front door no longer argues against entering.** The landing page states a promise, names the audience by tool (Cursor, Replit, Lovable, Bolt, Claude Code, Codex), and puts three trust markers directly under the primary action: *No credit card to start · Your approval before merge · No stored copy of your code*. `/privacy` and `/terms` exist and are linked from the signup form — the prior audit found neither anywhere.

**The diagnosis→action seam is built.** `moves_ranked` renders *"From your audit: People don't yet have a clear way to pay you"* under **Why this move**. The prior audit's sharpest structural complaint was that `sourceConclusionKey` existed in the database and never reached the screen. It reaches it now, and the onward link (*Open this move in Agent*) is there beside a priced action (*Plan this move · 20 Credits*).

**The merged change no longer calls itself unmerged.** The prior audit found *"Not merged"* three times on a merged, production-verified change. Across `merge_merged`, `outcome_not_observed` and `outcome_verified`, that string is gone. **What Vibe changed** and **Why this matters** now open the card instead of sitting below the merge button.

**Error states are better than most products'.** `onboarding_failed` says what happened, then what is safe — *"Your project and your connected repository are unchanged — this step only reads and concludes, it never writes to your code"* — then offers exactly one action.

**Zero horizontal overflow at 390 px** across every captured surface, matching the prior audit's result.

---

## 2. Findings

### F-1 · Twenty-two of twenty-nine routes have no browser title · **Contract violation** · High nuisance, trivial fix

[`UX-CONTRACT.md`](../../../UX-CONTRACT.md) §Navigation opens with *"Every route has a truthful metadata title."* Seven routes have one. `privacy` and `terms` do it correctly (`Privacy — Vibe Business`).

Everything else — the landing page, sign-in, sign-up, forgot-password, the account dashboard, onboarding, both GitHub connect steps, project Home, Plan, Agent, Product, Deep Scan, Experiments, Settings and Activity — inherits `Vibe Business` from the root layout.

**As a customer:** every tab is called the same thing. Two Vibe tabs open and you are guessing. A bookmark saved from the Plan screen is indistinguishable from one saved from Billing, and browser history is a wall of one repeated word. This is the cheapest reputational tell in the product: a founder switching between their own app and Vibe sees the difference immediately.

**Evidence:** 22 `page.tsx` files under `src/app/` with no `metadata` export and no `generateMetadata`.

### F-2 · Three auth pages carry two `<h1>` each · **Contract violation** · Accessibility

`/login`, `/signup` and `/forgot-password` each render two level-one headings: the marketing headline on the left panel (*"You vibe-coded the product. Now vibe the business."*) and the form heading on the right (*"Create account"*). `UX-CONTRACT.md` specifies *one route-owned H1*.

**As a customer using a screen reader:** the page has no single answer to *what is this*. Heading navigation offers two competing top-level answers, and the first one it reaches is the decorative one.

Visually the layout is good and should not change; only the element does.

### F-3 · A Move can promise a question that is not on the screen · Broken promise

`move-card.tsx:54` renders *"Answer the question below so Vibe can continue."* whenever the resolved execution state is `needs_user_input`. The question itself — `FounderInputCard` — renders in `plan-detail-panel.tsx:314` under a **different and independent** condition: whether `planView.founderInputRequest` exists.

Nothing derives one from the other. The `moves_ranked` fixture is exactly the mismatch: the badge says *Needs your input*, the card says *answer the question below*, and everything below it is **Why this move** and **Plan the work**.

**As a customer:** you are told to answer a question, you scroll looking for it, and the screen ends. There is no error, no empty state, nothing to do — the instruction simply has no referent.

Note that the same component's other branch gets this right: when execution state is absent it says *"Vibe needs a decision from you before this can move"*, which promises no location. Either both branches should avoid the spatial claim, or the two conditions should be one value.

### F-4 · "Verified" carries two meanings on the same screen · Trust peak

On `outcome_verified`, a founder reads **"Production outcome verified"** as a section heading, and twice on the same screen **"Vibe has not verified a deployment"** and **"no deployment has been verified"**.

Both statements are true and they are about different things: Vibe verified the public behaviour of two files, and did not verify that a deployment happened. But the screen uses one word for both and expects the reader to hold the distinction. This is the residue of the prior audit's finding that the surface "contradicts itself at the trust peak" — much reduced, not gone.

Two smaller things sit in the same block: `main now points at 78cbdac` puts a commit SHA in customer-facing copy, and every timestamp on these screens is `UTC` (*14 Aug 2026, 14:40 UTC*), which is not the clock a founder reads.

### F-5 · The Move stepper truncates every step but the active one · Minor

`moves_ranked` shows *Decide how customer…*, *Add a pricing surface..*, *Say who the product i..*, *Talk to ten people wh…* — four titles, all cut, and cut with two different ellipses (`..` and `…`).

**As a customer:** the stepper is the product's answer to *what is the plan*, and three quarters of it is unreadable without clicking. The information the founder came for is the one thing the component elides.

> **[2026-09-02, later the same day] All five are fixed.** F-1: a title template in the root layout and nineteen routes given their own name, guarded by `src/app/route-titles.test.ts` — three exemptions, each argued, and a stale one fails too. F-2: the marketing headline is a `<p>`, on the argument that a heading which disappears below `lg` cannot be what the page is about. F-3: the copy stays and the conditions are coupled — the caller knows whether the question renders below and hands the answer in, so the card falls back to its own location-free wording otherwise. F-4: "verified" belongs to the outcome check alone; the deployment facts say themselves plainly, and the merge panel's test was moved from pinning the sentences to asserting the claim, rule 74's CI/CD half included. F-5: two lines and a little more width fit every current title.
>
> Re-captured after the change: all four stepper steps read in full, the card on `moves_ranked` now says *"Vibe needs a decision from you before this can move"* because no question is below it, and `has not verified` appears nowhere on `outcome_verified`.

---

## 3. Four findings that were wrong, and why that matters

Each of these looked like a defect in a first pass and none of them is one. They are recorded because the same method will produce them again.

| Apparent finding | What it actually was |
|---|---|
| Raw field names as UI — `monorepoTool null`, `sourceFileCount 431`, `treeEntriesConsidered 812` | Inside a **collapsed** `<details>` labelled *Technical details*. Correct progressive disclosure. |
| Source paths shown to a founder — `src/app/robots.ts` | Same: behind *How this was built*. |
| Branch names and SHAs as content — `vibe/seo-foundations-cc32273131c5` | Same. |
| Four console errors on every page | `_vercel/insights` and `_vercel/speed-insights` 404 because they exist only on Vercel, plus two aborted Next prefetches. Local-server artefacts. |
| 58 of 67 surfaces have no `<h1>` | The fixture route renders panels **without** the workspace shell, and the shell owns the H1. |

Extracting text from HTML sees what a customer cannot: collapsed disclosures are in the DOM. **An audit that greps the rendered markup will invent findings at roughly the rate this one did — four false to five true.** The fix is to strip closed `<details>` before reading, which this audit's second pass did, and after which all four vanished.

---

## 4. What is missing, as a customer

Stated as gaps rather than defects, and limited to what a rendered surface can support.

- **No way to tell one tab from another** (F-1).
- **No visible answer to "what will this cost me in total?"** Individual actions state their price — *Plan this move · 20 Credits*, *Re-scan business · 20 Credits* — which is the contract's requirement and is done well. What no surface answers is what the whole plan costs if a founder does all of it. The stepper knows there are four Moves.
- **"The AI provider could not be reached"** names a vendor category a founder has no model of. The sentence beside it — what is safe, what was untouched — is excellent; the first sentence is engineering vocabulary.
- **The `20 Credits` at top right of the Move surface is ambiguous.** Beside *Re-scan business* it is a price; floating at the top right of a screen it reads like a balance. The contract requires the price beside the action, which is satisfied; the ambiguity is one of position.

---

## Appendix — method, and what it cannot see

**Rendered.** A production build served in the repository's own fixture mode: `VIBE_E2E_FIXTURES=1` with a placeholder Supabase host that fails at DNS, so contact with a real backend is structurally impossible. Nothing was mutated — no database, no GitHub, no AI call, no Credit spent.

**Captured.** 134 full-page screenshots: 61 fixture scenarios plus 6 public pages, at 1440×900 and 390×844. The scenario list was verified against the running server rather than read from source — an invented slug returns 404, all 61 return 200. Console output was recorded per page and filtered for the local-server artefacts named in §3.

**Browser.** Chromium 141 through `playwright-core`, launched with an explicit `executablePath` of `/opt/pw-browsers/chromium`. This matters beyond this audit: eight consecutive sprint records state *"No E2E run — the same container limitation"*, and the limitation is a path mismatch between the version Playwright's registry expects (`chromium-1234`) and the version the image ships (`chromium-1194`). The browser was always there.

**Not covered, and it is the larger half.**

- **Every signed-in route.** `/app`, `/app/onboarding`, `/app/billing` and the rest return `307 → /login` without a session.
- **The whole journey.** Fixtures render *panels*, not pages: no workspace shell, no rail, no navigation, no click from one screen to the next. The prior audit's three worst findings were all about seams, and seams are exactly what this method cannot reach.
- **The deployed product.** This environment's egress policy answers `403` to `CONNECT` for `vibebusiness.de` and for Vercel previews. Not a credentials problem — the host is unreachable at the network layer.
- **Anything real.** A GitHub App installation, a Stripe checkout return, how long an agent run actually takes, and what any of it feels like when it is your own repository.

**What would close the gap.** Either an environment whose network policy reaches the deployed site plus a test account, or fixtures for the screens the shell wraps — dashboard, connect, workspace chrome — which would also make the journey a CI-repeatable regression net rather than a periodic manual read.

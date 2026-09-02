# 0017 - Visual Review Artifacts

Status: Accepted; superseded by [0065](0065-the-preview-is-the-review.md) in its role as a gate — the artifacts, their retention and their signed-URL rules stand for the rows that exist
Date: 2026-08-14
Builds on [0012](0012-authenticated-browser-analysis.md), [0016](0016-temporary-preview-isolation.md)

## Context

Sprint 10B ended with a preview a user can open: the exact validated artifact, running on a public-unlisted URL for fifteen minutes. That closed the gap between "it builds" and "it runs", and opened a smaller one.

A user still has to answer *what did Vibe actually change?* — and the tools for that were a diff and a link. A diff requires reading code. A link requires holding two tabs side by side, from memory, before the preview expires. Neither is review; both are homework.

The first real prepared change is the standing example: byte-perfect, validated, previewable, and it listed `/login` in a sitemap. Nothing automated caught that and nothing in this ADR would either. What a person needed was to *look*.

## Decision

### 1. Review is its own trust gate

```
repository_write_verified   the bytes on the branch are the bytes we meant
sandbox_validation_passed   those bytes install, typecheck, test and build
preview_available           that exact artifact runs and is reachable
review_artifact_available   ← this ADR
human_approved              someone looked and decided
merged / deployed           neither exists
```

`review_artifact_available` means exactly:

> Vibe captured a controlled representation of the current live product and of the prepared preview, so a person can compare them.

It does **not** mean the change is good, the design improved, SEO is correct, a business outcome improved, anyone approved it, or a merge would be safe. It is evidence *for* a decision, never the decision.

### 2. Screenshots, never embedding

```
untrusted website → isolated browser → screenshot image → Vibe review UI
```

never

```
untrusted website → Vibe DOM
```

No iframe, no proxying HTML, no DOM import, no page source persisted. What crosses the boundary is a PNG and four numbers.

This is what allows the review layer to look at both a customer's live product *and* a sandbox serving code Vibe did not write, without either reaching Vibe's own origin. It is the same principle as [ADR 0012](0012-authenticated-browser-analysis.md), applied to a different question.

### 3. Public pages only, in V0.1

Production authenticated state and preview authenticated state are not comparable without moving credentials or session state between two origins. Vibe will not do that, so it does not compare authenticated pages — and says so with its own failure code (`review_auth_required_not_supported`) rather than silently comparing two logged-out screenshots as though they meant something.

The capture adapter makes this structural rather than procedural: it creates a **fresh** browser context per capture and never reads or writes `storageState` or cookies. There is no code path that could carry a login across.

### 4. "Before" is the live product as observed, not a base commit

The before side is captured from the project's own **verified production URL** — stored normalized, HTTPS, credential-free — and from nowhere else. A client-supplied URL would let a caller point Vibe's browser at any site and have the screenshot stored under their project as though it were their product.

The honest semantics, recorded with every artifact:

> the public live product as observed at capture time

Not "the base commit". Production may have been anything at that moment, and it may change five minutes later. `before_origin` and `before_captured_at` are stored so a historical comparison can say what it looked at, and a later production change does **not** silently regenerate it.

### 5. "After" is one specific running preview

Not a branch, not a commit, not "a recent sandbox". The exact `PreviewSession`, checked to belong to the same PreparedChange and the same passing ValidationRun, and re-checked at capture time because a fifteen-minute preview can end inside a queue.

The preview session is therefore part of the **review identity**: two previews of the same commit are two different runtimes, and a comparison must say which one it photographed.

Vibe never starts a preview to make a review possible. Provider spend is the user's to authorize (§6, CLAUDE.md rule 60).

### 6. Comparability is pinned, and enforced

`review-policy-v1` versions everything that decides whether two images can honestly sit side by side: route, viewport, device scale factor, full-page mode, navigation timeout, settle strategy, animation handling, screenshot format.

Two properties are worth naming:

- **Fixed viewport, not full page.** Full-page height varies with content, so two full-page screenshots of different lengths cannot be laid side by side without scaling one — and scaling is how a comparison starts lying.
- **Bounded settle, never `networkidle`.** A live product can hold a connection open indefinitely, so `networkidle` may never arrive and would turn a screenshot into an unbounded, billed browser job. The Deep Scan connector learned this first.

The database enforces the part that matters most: a `ready` artifact must have **both** sides captured and **identical** dimensions. Even a wrong workflow cannot store a mismatched comparison.

### 7. A one-sided comparison is a failure

If either capture fails, the artifact is `failed` and any already-uploaded image is removed. A single image rendered beside an empty panel reads as *"the change deleted the page"* — a worse outcome than an honest error.

### 8. ReviewArtifact outlives PreviewSession

This is the point of separating them.

A preview is a running sandbox that stops after fifteen minutes and whose validated artifact is deleted at teardown. A review is two immutable images of a moment. Collapsing them would mean either that a user loses their comparison the instant cleanup runs correctly, or that a paid sandbox is kept alive so a screenshot stays visible.

So `review_artifacts.preview_session_id` is `ON DELETE SET NULL`, and the comparison stays viewable after the preview it recorded is gone. **Open preview** disappears; the images do not.

### 9. Private storage, authorized reads, bounded retention

The bucket is private. The only route to an image is a short-lived signed URL minted server-side **after** the application confirmed the caller owns the project.

> **Corrected by the first real dogfood, 14.08.2026.** This section originally said the bucket carried *no* `storage.objects` policy at all, and called that the whole posture: the application authorizes, then signs, so RLS had nothing left to decide.
>
> That was wrong about the mechanism. `createSignedUrl` is itself an RLS-checked read of the object, performed with the caller's own token — so with no policy, the owner could not sign their own screenshots. The first comparison captured both sides, stored both PNGs, reached `ready`, and rendered "Loading comparison…" forever.
>
> Migrations `20260814100000` and `20260814101000` add a **SELECT-only** policy on that bucket for objects under a project the caller owns. Writes and deletes still have no policy and remain service-role-only. The application still authorizes before it signs; that check is simply no longer the only one.
>
> It took two migrations because the first one's predicate used an unqualified `name`, which bound to `projects.name` inside the subquery rather than to the object path — valid SQL that matched nothing, with no error to say so. Verified after the correction: the owner sees both objects, another authenticated user sees none, `anon` sees none.
>
> This is the mirror image of [ADR 0016 §14](0016-temporary-preview-isolation.md): there a write the application had authorized was refused by RLS and the error was swallowed. Both came from the same false premise — *the application checked, so the database does not need to.* A gate closed to everyone is closed to the owner too.

The ordering is the authorization: **authorize, then sign**. A signed URL is a bearer credential, so it is never persisted, never logged, never placed in an audit event and never put into an AI prompt.

Retention is **seven days**, chosen. Longer than the preview it came from — because the artifact exists so the sandbox can be stopped — and short enough that Vibe is not indefinitely storing images of a customer's product. Not inherited from a storage default, which is what happens when nobody decides.

### 10. Explicit generation, because a browser costs money

No capture happens on preview-ready, on page load, on panel open, or on validation passing. Only an explicit **Generate comparison**.

A browser session is billed by the second, and spending a user's money without being asked is the invisible cost CLAUDE.md rule 60 forbids. There is a regression test asserting zero operations, zero sessions and zero ledger rows for a user who merely opens the panel.

### 11. Durable execution, for authority rather than duration

Two captures and two uploads are four external side effects, and the usage ledger has **no INSERT policy** — so its write requires the service-role client, and only durable execution may hold one (CLAUDE.md rule 53).

This applies the Sprint 10B lesson *before* it can bite again. There, an inline preview stop wrote its ledger under the cookie-scoped client, RLS refused it, and the best-effort handler swallowed the error: the preview stopped correctly and its spend was recorded nowhere. The threshold that matters is not how long work takes, but whether it needs the privileged writer.

`provider_cost_usd` stays null: Browserbase reports no attributable price, and a figure derived from a rate card would be a guess wearing an accounting figure's clothes.

### 12. No visual quality judgement, ever

No score, no percentage, no "improved", no AI looking at the images. Zero AI calls in the entire review path.

An automated visual check is a real future capability and would be its own gate with its own evidence. Attaching a number to a screenshot pair now would create a verdict the product cannot justify, and users would trust it.

## Consequences

### Positive

- A non-technical user can answer "what changed?" by looking, in one screen.
- The comparison survives correct cleanup of the preview, so nothing is kept running for the sake of a screenshot.
- Screenshots are private by construction, and expire on a chosen schedule.
- Browser spend is measured in its own narrow ledger, separate from Deep Scan and from inference.

### Negative / Tradeoffs

- **One route, one viewport.** A change below the fold, on another page, or only visible on mobile will not appear in the comparison. The product must not imply otherwise.
- **Public pages only.** Anything behind a login is out of scope, and honestly reported as such rather than approximated.
- **A comparison costs a browser session.** It is explicit, and it is not free.
- **Animation freezing is best-effort.** CSS animation, transitions and caret blinking are disabled; a canvas animation or a playing video is not, and could still differ between captures.
- **"Before" is a moving target.** Production can change between two comparisons of the same change. That is recorded as a timestamp rather than pretended away, and a historical artifact is never regenerated.
- **Images and rows expire together at seven days**, so an old comparison eventually stops being viewable. Bounded retention was the deliberate choice over indefinite storage of customer product imagery.

## Related

- [0012](0012-authenticated-browser-analysis.md) — the browser-session boundary and why capability URLs never persist. This ADR adds a *capture* capability rather than widening that one.
- [0013](0013-durable-operation-execution.md) — durable operations. §11 above records why the deciding test is authority, not duration.
- [0016](0016-temporary-preview-isolation.md) — the preview this photographs, and §14 there, which established the same privileged-write rule after a real dogfood.

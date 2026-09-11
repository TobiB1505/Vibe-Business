# 0108 - A phone is not a narrow desktop

Status: Accepted
Date: 2026-09-10

Revises the layout rule in [DESIGN.md](../../DESIGN.md) that said account and project pages use *"a top strip below the large breakpoint"*. Under [ADR 0098](0098-design-rules-are-revisable-truth-rules-are-not.md) that is a design rule and revisable in place with a better argument. The `<aside>` still belongs to the shared layout and the navigation still arrives through the `@rail` slot ([ADR 0105](0105-one-rail-that-unfolds.md), [ADR 0106](0106-the-rail-is-a-layout-per-area.md)); what changes is what that element *becomes* below `lg`.

## Context

The rail was never designed for a phone. It was designed for a wide screen and then allowed to fall into one column, which is what `flex-col lg:flex-row` does if nobody decides otherwise. Measured on the production build at 390×844, in the v2 palette:

- The strip occupied **476px of an 844px viewport**. `main` began at y=476 and the page heading at y=546, so a founder's first screenful of their own product was the navigation, the project switcher, the balance, the identity and a palette switch.
- The section list was a horizontal scroller holding **836px of content in a 358px window**. Less than half was visible, the fifth item was clipped mid-word, and the only thing saying more existed was a fade.
- **Eight controls in the rail were under the 44px touch minimum** — the top-up control at 40×40, the identity at 40, two rows at 38.

None of that is a bug in the sense a test could hold. There was no overflow, no error, no missing element; every assertion the suite made about the rail was true. It was wrong in proportion, and proportion is only visible in a browser at a real size.

The underlying mistake is one sentence: **a rail is not a thing that gets smaller.** On a wide screen a column down the left is *peripheral* — the eye starts on the content and the navigation waits in the corner of vision. Stacked into a single column it becomes the first thing on the screen, and its position now says "read me first" about chrome. The account level suffered worst: the balance and the identity, which belong to the whole account rather than to this product, ended up above the product's own heading because the rail's footer became the page's third paragraph.

## Decision

Below `lg` the `<aside>` stops being a box and becomes a **layer**: `fixed inset-0`, `pointer-events-none`, no surface of its own. Its children place themselves and turn pointer events back on.

Inside that layer, the phone's navigation is **two levels in two places**:

- **The bottom bar** holds the sections of the product a founder is in — four of them, in the thumb's reach, with the rest behind *More*. Four rather than six because a tab is a fifth of 390px, and at six the labels stop being words. Each section therefore carries a one-word `short` name beside its full one, in `PROJECT_SECTIONS`, so the two names cannot drift.
- **The corner** holds the account: one avatar, opening a bottom `Sheet` with the identity, the balance and account settings. An avatar rather than a burger, because a burger promises the rest of the navigation and this is not the navigation.

The top bar carries the lockup and nothing else. The product's name is already the page's breadcrumb and its heading; a third statement of it would cost a phone's scarcest measure.

Both bars are **opaque**, and this is the one place in v2 where chrome is. Everywhere else a chrome surface is a film with the page blurred behind it, which works because what is behind it is the ground. These are fixed over arbitrary scrolling content, and measured, the page read straight through: section labels sat on a sentence about the product, both legible and neither readable. The film is composited over `--color-ground` instead — the same colour, no transparency. That holds in **both** palettes, because `--color-surface-1` in v1 is itself a 2.4% white and the bar was see-through there too.

`empty:hidden` still decides whether this product has chrome at all. Everything mobile lives inside the one element it governs, so onboarding and the GitHub connect flow lose the whole of it in one rule, exactly as before — and the content column reserves the two bars' heights through `:has()`, so a rail-less route is not padded away from the top of the screen as if it had them.

## What this found on the way

Three defects that existed before this work and were invisible because nothing looked:

1. **The consent banner covered the navigation.** It is `fixed bottom-0 z-50`; the tab bar is `z-40`. Every tap on a section was intercepted, so a founder who had not answered the cookie question could not move around the product at all. It never showed in a test because `playwright.config.ts` sets a refusing consent cookie for the whole suite — the banner appears in exactly one spec, and that spec does not look at navigation. The banner now clears the bar; raising the bar above it would have put navigation over a consent decision.

2. **`Sheet`'s bottom variant was never a bottom sheet.** A modal `<dialog>` is given `inset-block: 0` by the browser, and a fixed box pinned at both ends with `height: auto` fills — so `mt-auto` had nothing to push against. It rendered as a full-screen panel with its rows at the top. Its height cap was also set twice, here and in the shared class list, and `cn` is a filtered join rather than `tailwind-merge`, so both shipped and stylesheet order picked the wrong one: `max-h-dvh` beat `max-h-[85dvh]`.

3. **v2's `.vibe-overlay` set `position: relative` on dialogs.** That anchors the sheen on a panel and is right there; on a modal dialog it replaces the positioning the platform gives a top-layer element, so the sheet laid out in normal flow inside whatever contained it.

All three are fixed where they were, not worked around in the new code.

## Consequences

The phone gets **420px of its screen back**: `main` starts at 56px instead of 476, the heading at 126 instead of 546. Every control the shell owns is now at least 44px, and there is no sideways scroller on the screen.

There is one more component to keep true. `MobileTabBar` and `ProjectNav` are two presentations of one array, and each has its own copy of the active-route rule. That is deliberate — a shared helper would still have to be told which item is the index — but it is a second place that can be wrong, and `e2e/mobile-shell.spec.ts` is what holds it.

Sheet bodies mount only while open. That is a correctness rule rather than a performance one: the wallet, the switcher and the identity are already rendered by the rail for a wide screen, and mounting both put two of each in one document. The browser suite caught it immediately — `getByTestId('wallet')` resolved to two elements, and "offers one way to add Credits" is a claim about the product, not about a selector.

What this does **not** do is the screens. Page content still has its own touch targets under 44px, its own tables and its own dense rows, and the landing page's consent banner still lands on the hero's primary action at 390px. This decision is the shell; the screens follow it.

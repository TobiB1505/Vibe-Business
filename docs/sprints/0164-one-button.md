# Sprint 0164 — One button

**Date:** 2026-09-08
**Decision:** system C from the button study — one component, four variants, icon-only as a size.

## What was asked

*"Jetzt finde ich noch design system technisch, dass wir uns für einen Button entscheiden — schau dich mal um und schlag mir Varianten vor."* Four systems were drawn in `study-button.tsx` against the six jobs the product actually has. Then: *"Weiter."*

## What the counting found

Five families made something pressable, and none of it was a decision anybody made:

| | |
|---|---|
| `Button` | 94 renders — primary 63, secondary 28, accent 3, **danger 0** |
| `InlineAction` | 21 call sites across 18 files, 3 of them destructive |
| `IconButton` | 1 |
| `TextAction` | 1 |
| `buttonClasses()` on a `Link` or a raw `button` | 28 files |

Two ends of one failure. **`danger` was dead code** for the whole life of the component while the product had three destructive actions — all of them an `InlineAction` with a `danger` tone. So the destructive *button* was unused and the destructive *action* was alive, which is one vocabulary pretending to be two. **`accent` was three uses** of a rung between "the action" and "a control" that no rule could state.

And the irony worth recording: `InlineAction` exists in its own file *because* nine controls had each been written by hand. Naming the category stopped the ninth from becoming a tenth, and then the named category became the third system.

## What shipped

`ButtonVariant` is `primary | secondary | ghost | danger`. `ButtonSize` is `lg | md | sm | xs | icon`. `InlineAction`, `IconButton` and `TextAction` are gone, and `buttonClasses()` still exists for the twenty-eight `<Link>`s that have no component to hang a prop on.

**Nothing looks different, deliberately.** `ghost` is `InlineAction`'s neutral tone verbatim and `danger` is its danger tone verbatim, down to the pressed values; `xs` is its 28px pill and `icon` is `IconButton`'s 32px circle. Twenty-three call sites changed import and render the same pixels — the only honest way to do a migration this size is with no visual regressions hiding inside it.

Two arguments came with those tones and are now asserted rather than remembered, because both are one edit from being lost and the edit that loses them still looks fine on a laptop:

- **A container exists at rest.** Touch has no hover, so `ghost` is not transparent-until-hover — it has a resting fill. Not what the word usually means elsewhere, and it was learned from a phone.
- **Destruction warns at rest.** A danger tone that arrives on hover never arrives on a phone, and "Delete account" and "Change" become the same grey object.

## The one thing that did change, and the measurement that decided it

`accent` had nowhere to go. Its three call sites became `primary` — and the rendered billing page then carried **five mint solid buttons**: the hero's "Buy Credits", three "Buy", and "Choose Pro". A page that shouts. `accent` had been doing real work there, subordinating the card-level purchases to the hero.

Under four variants the honest answer is `secondary`: a grid of packs and plans is a set of *alternatives*, and the page's one primary is the hero. Screenshotted both ways before choosing. Validation's "Run the checks" stayed `primary`, being the only action of its stage.

## What the new guard caught on its first run

`live-site-step.tsx` had a `<Button formAction={…}>` with no `type`. It worked on the browser's implicit `submit` inside a form — and `Button` now defaults `type="button"`, because the implicit default is what turns a "Cancel" or a "Clear" into a form submission the moment those controls stop being their own component (`InlineAction` hard-coded `type="button"`; `Button` did not). "Continue without live product" would have gone quiet. The guard names `formAction` specifically for that reason.

The `label` requirement survived the fold, as a union: `size="icon"` requires it, every other size forbids it. That requirement was the whole reason `IconButton` was a separate component, and folding it into a size is exactly how it would have been dropped — an icon-only control with no accessible name is announced as "button", and the entire category is icon-only.

Also gone: `.vibe-control-text` in `theme-v2.css`, which nothing emits now that `TextAction` does not exist.

## Guards, and what each mutation proved

`src/components/ui/button.test.ts`, six mutations, all caught:

| Mutation | Failed |
|---|---|
| `ghost` loses its resting fill | gives every variant a container at rest |
| `type = "button"` removed | defaults to a button and not to a submit |
| `formAction` button drops its type | makes a submitting button say so |
| radius and gap move back into the base | keeps radius, padding and gap in the size scale only |
| a fifth variant is added | offers no fifth |
| nothing asks for `danger` any more | danger reaches a screen |

The last one is the guard against this sprint happening again: **a variant with no call sites fails**, because a variant nobody can place is one the next person places by guessing. The list is a description of the product, not a menu.

Radius, padding and gap live in the size scale and are kept out of the base by test, because `cn` is a filtered join and not `tailwind-merge` — a base `gap-2` and a size `gap-1.5` both ship and the stylesheet decides. This file has already paid for that once: three CTAs carried `text-body` and `text-base` together and rendered at 14px while their class string said 16.

## What the guard's own first draft got wrong

`/<Button[\s\S]*?>/` matched to the first `>` — which in a real call site is inside `icon={<DismissIcon size={16} />}`, so it reported the drawer's dismissal as an icon button with no label. Replaced with a depth-tracking scan. A lazy regex over JSX reads the mark as the end of the tag.

And a whole-file `pnpm format` over the migrated files rewrapped code they were not editing — 355 lines in one of them, none of it about buttons. Reverted and redone by formatting only the tags that changed. Rule 84 exists because the repository is not written to one width; a formatter run on the way past is a reformat, not a tidy.

## Validation

Unit 8,873 · browser 639 · lint 0/0 · typecheck clean · no migration. Billing, project settings and products screenshotted at 1280 before and after.

**One thing found on the way, not mine and not fixed here.** A mid-sprint run had `src/modules/auth/actions.test.ts` failing 11 tests with *"Too many sign-in attempts. Try again in 12 minutes."*; the final run is green. The cause is not flakiness in the ordinary sense: that file mocks `@/lib/supabase/server` but **not** `@/lib/supabase/service`, so `signInWithPassword`'s throttle reaches the **real remote database** and records an attempt on every test run. Enough runs in fifteen minutes trip the per-account lock and the whole `signInWithPassword` describe fails until it expires. Green means the window passed, not that the test is sound — a unit test should not be writing to the production database, and it deserves a fix of its own rather than a line in a button sprint.

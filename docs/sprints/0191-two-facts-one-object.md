# Sprint 0191 — Two facts, one object

**Date:** 2026-09-08
**Decision:** treatment A from `study-profile` — the page is one card with hairlines in it.

## What was asked

The Profile page audited in v2, then four shapes, then the one the founder picked. **A.**

## What the audit found, measured

At 1280 and at 390, on `profile-named` and `profile-no-github`, with `VIBE_PALETTE=v2`.

- **Two mint primaries, and the loud one was the small one.** `Save` on the name field and `Connect GitHub` were both `variant="primary"`. The field that decides what Nova calls you outranked the connection the whole product runs on.
- **Four objects at four densities for two facts.** A 138px card holding a name and an address, a 248px card holding one input, a 153px panel holding one row, a 183px section holding three bullets — on a page 1001px tall. Nothing was wrong with any one of them; together they said the page had four subjects.
- **`MonoLabel` in two places.** `YOUR NAME` and `CONNECTIONS` above their surfaces, `WHAT VIBE DOES NOT KEEP` inside its own.
- **248px of card around one input.** Label, field, hint, button, stacked.
- **A hand-drawn bullet**, `bg-fg-faint mt-2 size-1 rounded-full`, in the one panel whose subject is that Vibe keeps nothing.
- **The emptiest object was the largest.** Without GitHub: a 72px circle reading `FO` beside `founder@example.com`.

## What the registries had

ReUI: **nothing free** for a profile or settings shape — thirteen premium blocks and no free match, the same answer it gave for buttons in 0186. 21st.dev had two worth reading: an **Account Settings Fieldset** (the form on the ground, no card, one save at the foot — the shape behind treatment D) and a **Glass Account Settings Card** (one large pane with smaller cards nested inside it — A, minus the nesting). Neither was installed. What this study was choosing is a composition, and a composition is not a component to fetch.

## What shipped

One `Surface level="card" padding="none"` with four rows divided by a hairline: the person, the name, the connection, and what Vibe does not keep. Nothing nested. 1001px → **900px** at 1280, 1461px → **1136px** at 390.

`Save` is secondary. Mint is spent once, on `Connect GitHub`, and only in the state that offers it — connected is the common state and it carries **no accent at all**, rather than moving the accent onto the next loudest thing.

The `</>` glyph becomes `GithubMark`. It was a drawing standing in for a logo the product is allowed to show, on the single named provider on the page — the same finding as 0189, one page over.

The bullet becomes a left hairline. The section labels collapse to one, because the rows label themselves.

## `Field` grew a second layout, and the argument for it being a prop

`layout="row"` puts the label and hint on the left, the control on the right. `column` is a form; `row` is a settings line, and a settings page is a list of things a founder *has* rather than a form they are filling in.

A prop rather than a second labelled control written by hand beside this one, because the whole point of `field.tsx` is that there is one place a labelled control comes from — the thing `field.test.ts` exists to enforce. The layout is the only difference; the `htmlFor`, the hint id, the alert role and the describedby wiring are identical, and three new guards assert exactly that.

## Three things measured rather than assumed

**The width went on a wrapper, not on `Input`.** `inputClassName` already carries `w-full`, and `cn` joins rather than merges, so a `w-56` passed as `className` ships beside `w-full` and the stylesheet's order decides. A box around it has no argument to lose.

**`flex-wrap` does not stack a row.** First draft: `min-w-0 flex-1` on the words, `shrink-0` on the control. At 1280 it is the row it should be. At 390 `flex-1` let the label column shrink *past its own words* — "What should Nova call you?" came out one word per line beside a 314px control group. It stacks below `sm` now, which is what `column` is for, and the guard asserts the breakpoint rather than the wrap.

**`text-balance` on the connection's sentence.** It broke after "a", leaving "change." alone under two otherwise tidy rows.

## Four guards that were worth nothing until they were mutated

Every new assertion was checked by breaking the thing it guards.

**Three of the first four passed under their own mutation.** The row-branch slice was `indexOf('if (layout === "row")')` to `lastIndexOf("return (")` — and `FormError` is declared after `Field` and has a return of its own, so the slice ran to the end of the file and every assertion was satisfied by the *column* branch it was supposed to be measuring against. Bounded by the next function-body-level `return (` now. `htmlFor`, the hint id, the stacking and both `role="alert"` branches now fail when removed.

**And one browser guard measured nothing at all.** `page.evaluate` given the string `"() => {…}"` evaluates it as an expression and hands back the function, which serialises to `undefined` — so `expect(undefined).toEqual([...])` was the only thing that ever failed, and it failed for the wrong reason. It is a real function now.

The accent is read from `--color-mint` at runtime rather than written into the test as `rgb(0, 229, 160)`: both palettes declare that token, and a literal would have stopped measuring anything the day this page is looked at under v2.

## What is not fixed

The circle still says `FO` for `founder@example.com`. `initialsFrom` takes the first two letters of a single token and is used by product tiles as well as by identity, so changing it is a wider decision than one page — and the card around it is 100px now rather than 138px. Named here rather than quietly left.

Unit 9,475 · browser 744 with 3 new · tsc clean · eslint 0 · build clean

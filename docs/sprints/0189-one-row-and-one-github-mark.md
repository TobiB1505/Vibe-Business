# Sprint 0189 — One row, and one GitHub mark

**Date:** 2026-09-08
**Decision:** treatment B from `study-repositories` — the list is a row, not a grid.

## What was asked

The audit's findings, and then four shapes. The founder chose **B**, and added one thing: keep the GitHub logo.

## The logo, which was already there — three times

It was. And the audit had flagged it as a duplicate, which understated it: `src/components/brand/provider-marks.tsx` holds the **canonical** `GithubMark`, with a docblock arguing exactly why a third-party brand mark lives there and is reproduced rather than restyled. Beside it, `page.tsx` and `repositories-index.tsx` each carried a hand-drawn GitHub logo — and **the two paths are not the same**. 564 characters against 514. The product shipped two subtly different GitHub logos and a correct one nobody used.

All three sites use the canonical mark now.

## What B is

One renderer. This page was a `<table>` above `md` and a `<ul>` below — roughly a hundred lines each, hidden from one another by breakpoint, and already disagreeing about what a row contains: the table showed the name *and* `owner/name` and carried its own open-arrow; the list showed `fullName` and had neither.

A grid earns its columns when a reader compares values down one, and **nobody compares connection dates**. What is left is a sequence — mark, repository, product, branch, state, when — and a sequence wraps. The same row serves 390px and 1440px, with no second implementation to keep in step.

The repository leaves the product, so it carries the turned arrow every other external link in Vibe does (UI-30). The name leads and the owner follows: at 390px the old title was `owner/name` truncated, which cut the identifying half and kept the half that is identical on every row.

## The critical finding, and why the number was wrong

The header printed `repositories.length` twice — once labelled **Products**.

`listConnectedRepositories` starts from every project and joins the live connections, so a project without a repository produces no row. The count was never the number of products; it was the number of repositories, said twice. The two part company **on the first Disconnect** — which this product's own project settings offer, and render as "No repository connected".

**Public** went for a duller reason: repositories minus private. Three of the four numbers were one fact. Two remain, and both are computable here.

Also gone: the `Connected` pill beside a heading that already says *GitHub connected*.

## The focus ring that was a 26%-alpha border

Measured with real Tab presses: the search field and the sort select both had **no outline in any state**. Both set `outline-none` — they have to, or the native control paints its own box inside ours — and what replaced the global mint ring was `focus-within:border-mint-line`: a 1px border going from 8% white to 26% mint.

Three pixels away, `SegmentedControl` drew a proper ring with `has-[:focus-visible]:ring-mint ring-2`. Three controls in one row, two focus mechanisms, one of them effectively invisible. Both take the segmented control's mechanism now, for the reason that component already records: the element that takes focus is not the element a sighted user is looking at. `SortSelect` is shared, so Products gained the fix too.

## Smaller things the audit named

"Manage connection" rendered **61px tall** beside 40px controls because its two words wrapped in a column the four metrics had squeezed. The clear mark in the search field was a literal `×` — the third file in this repository to carry a text character where the icon frame belongs, after the disclosure caret and `ArrowIcon`. The pager wrote its own border and padding instead of `buttonClasses`.

Removing the `×` made the type-scale allowlist stale, and the guard said so: an exception listed for a file that no longer uses one is dropped, not left.

## What was found and deliberately not changed

**"How repositories are used"** — four tiles of assurance prose at the foot of the page. The audit reported it as a disagreement rather than a defect and it stays that way: my view is that "what does Vibe do with my code" is a question asked in the connect flow, not in a management list. Nobody asked for it to go, so it did not.

## Guards

Four browser assertions, all mutated:

| Mutation | Failed |
|---|---|
| the Products tile returns | prints no number it cannot compute |
| the sort ring is removed | draws a focus ring on the two controls that had none |
| the search ring is removed | draws a focus ring on the two controls that had none |
| the table returns | renders the list once |

The first mutation of the sort ring hit the wrong line — the class string appears twice in `list-controls.tsx` and a first-occurrence replace removed `SegmentedControl`'s instead. It was caught, by the older test that guards *that* ring, which is its own small proof that both are held.

An existing assertion also got sharper: `leaves every other row alone` filtered to `visible=true` **because** two renderers put two notices in the DOM. It counts DOM nodes now, which is honest and is also what fails if the second renderer ever comes back.

## Validation

Unit 8,884 · browser 645 · lint 0/0 · typecheck clean · no migration. Rendered at 1440 and 390: no control over 46px, no horizontal overflow, page height 1,159 → 1,050 at 1440.

**Not proved:** the row was measured at two widths with seven repositories, one of them revoked. Nothing has been seen with a repository name long enough to compete with a long product name in the same flex row — the fixture's longest is `vibe-business`.

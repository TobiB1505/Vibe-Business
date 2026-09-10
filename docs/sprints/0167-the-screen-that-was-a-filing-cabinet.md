# 0167 — The screen that was a filing cabinet

**Date:** 2026-09-07
**Decision:** none new. This is a composition rebuilt on a model the product already had; no boundary, provider or policy moved.

## The founder's instruction

> „Und ich möchte, dass Du ein komplett neues Dashboard baust. Also Du gehst in Templates bei, dann nimmst alles Skills her und verwirfst das jetzige Dashboard komplett und baust ein komplett neues Dashboard mit dem neuen System, neuen Designs, mit dem neuen Regeln."

## What the research actually returned

The registries were searched for the shape this screen needed — an analytics overview, a bento of application cards, a priority queue, an inbox with inline actions. What came back was landing-page heroes, KPI tiles and notification popovers. The closest match, a neo-brutalist "bento dashboard", is a different product in a different register.

The conclusion is worth writing down because it is the reason nothing was ported: **Vibe's dashboard is not a metrics dashboard, and no catalogue has its shape.** What was taken from the research is compositional rather than component-level — an asymmetric layout where one cell is the subject rather than a row of equal rectangles, and a staggered arrival — and both were built on primitives this repository already owns.

## What was wrong with the screen

It was organised by **object**: a signal card, a grid of product cards, a connect band. A founder arriving asks one question — *what do I do?* — and the product already answers it. `buildAttentionItems` ranks every waiting decision into four tiers, and the screen used that ranking to pick a hero and to sort a grid, then discarded it.

What that cost, measured on the three-product fixture: Payflow raises a **blocked** failed validation and waiting moves. The hero offered the moves. The card below said "Review change", which is the *waiting* change. The word "failed" appeared nowhere on the dashboard. The tier — blocked, decision, ready, setup — was not rendered at all, so a stopped change and a never-run audit were the same rectangle with a different verb.

## What was built

**The screen is the ranking.** One column, most urgent first. `desk.ts` builds it from the model, the first entry opens into the decision itself, everything below is a row, and a product with nothing waiting is a settled row rather than an absence. It reads the same with one product or twenty, it has no dead half at any width, and a product raising two decisions appears twice — which `attention.ts` says in its own comment is the point.

**The head is the decision, not the score.** The old card led with a number and put the task underneath. Now the tier and the product name are the eyebrow, what is waiting is the heading, what Vibe observed is the sentence, and the reading — ring, delta, chart — sits beside it as context. When the item is `moves_waiting` and the project carries a rank-1 Move, the Move's own title and problem replace the generic sentence rather than joining it.

**Rows, not cards.** Three equal cards make three things look equally urgent, which is the claim the tier order exists to deny, and a grid reflows into two columns at some width — at which point reading order stops being the ranking. A micro-sparkline was drawn on each row and removed: at 80px with the two or three readings a real account has, it was a dot, a dashed break and a stub beside the number that already is the reading.

**Motion, with the three obligations in the mechanism.** The desk arrives as one staggered sequence through `vibe-reveal`, which carries reduced motion and the hidden-tab pause structurally. The score ring draws its arc — admissible where a count-up is not, because an arc carries no label and no frame of it can be read as a score the audit did not produce. The number is present and correct at frame one.

**Deleted:** `signal-card.tsx`, `product-card.tsx`, and the attention panel added four hours earlier in Sprint 0166. [2026-09-10: that sprint is now 0213 — `main` had its own 0166.] **Extracted:** `ScoreRing` and `ProductMark`, which were private to the deleted files and are now used at two sizes each.

## Two measurements that changed a decision mid-build

**The reserved-geometry test failed, and it was right.** The first version compared `boundingBox()` across the entrance and failed by 2.07px. `vibe-reveal` *translates* the arriving element, so its painted box is meant to move; what must not move is everything around it. The test now reads `offsetTop`/`offsetHeight` — pre-transform layout values — and asserts the document height is stable. Mutation-tested by adding `margin-top` to the keyframe: it fails.

**`getByRole("button")` does not find a `<summary>`.** ARIA in HTML gives `summary` no corresponding role, so Playwright sees the `<details>` as a `group` with text and no interactive descendant. The account-menu test now drives the element and presses Enter, which proves the keyboard path rather than asserting a role the spec does not define.

## The ceiling moved down

`account-dashboard.spec.ts` capped the screen at 40 countable elements yesterday. The desk measures **12** at three products, because a row carries a title and a sentence where a card carried three labelled facts and its own action. The ceiling is now **24**: room for the fourth and fifth row a real account has, and not room for a second section.

## What else moved with it

The loading skeleton was still the old grid — one signal, one action band, three cards, a banner — and would have collapsed into a different layout on arrival. It is the desk now, at three rows rather than four: the count is unknown while the read is in flight, and guessing low leaves the list growing into empty page rather than shrinking under a cursor.

`UX-CONTRACT.md` named "`View action plan` on the account dashboard's signal card". There is no signal card; the row is the open decision's own control.

Unit 8,828 · browser 599 · lint 0/0.

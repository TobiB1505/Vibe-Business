# Sprint 0188 — The arrow means navigation

**Date:** 2026-09-08
**Decision:** none new. A rule made explicit and enforced.

## What was asked

*"Ich würde nur den Pfeil anzeigen wenn es ein Link ist. Wir haben jetzt Buttons die klar aussehen wie Buttons, wir haben jetzt viel zu viele Pfeile. Wir benutzen den Pfeil nur bei Links oder Weiterleitungen."*

## Why it became visible now and not before

Seventeen forward arrows: on links, on form submits, on a `<Button>` that changes a tab, and on a paragraph that is not a control at all. When a mark appears on everything it says nothing.

It surfaced because the buttons started looking like buttons. A surface says *press me* on its own — so on every control that had one, the arrow was doing that job a second time, and the difference between *this does something* and *this takes you somewhere* had nowhere left to live. The arrow was load-bearing back when a "button" was a word with a line under it.

## The rule

**A link may carry the arrow. A control that acts in place may not.**

Removed, five: the credit-pack "Buy · €33" submit, the "Manage or cancel plan" submit, "Explore this area" (a `<Button>` that switches a lens), "Go to your workspace" (a form submit), and one sitting in a `<p>` beside instructional text, on no control at all.

Kept, seven: `StandaloneLink`'s own mark, the repositories table's icon-link, "View plans", the product card, and the landing page's links.

**Buy and Manage or cancel plan end at Stripe**, which is arguably the "Weiterleitung" the rule allows. They lost the arrow anyway, and that is a judgement worth stating: a form submit looks like a button and behaves like one until it resolves, and those five arrows are most of what made the billing page feel arrow-heavy. If leaving the product needs a mark, the product already has one — the turned arrow on an external *link*.

## Two exceptions, and why neither is a hole

**The Move stepper's "Next move"** is a mark with no word beside it. Removing the arrow leaves an empty button. So the rule the guard enforces is sharper than "no arrows on buttons": **the arrow may be the label; it may never be an ornament beside one.** Expressed as `aria-label` on the opening tag, which an icon-only control has and a labelled one does not.

**The trend mark** in `audit-intelligence.tsx` says which way a score moved. Not navigation, and it stays a glyph.

Its two siblings did not. `ArrowIcon` also rendered a literal `→` inside two navigation links, while every other navigation arrow in the product is the drawn mark from the icon set (ADR 0097). A glyph takes the font's weight instead of the icon frame's 1.5px and sits on the text baseline rather than the optical centre — the same defect the disclosure caret records. Two arrows meaning one thing, drawn two ways, is part of why the meaning was hard to see.

## The bug the guard found in the guard

`arrow.test.ts` reported the Move stepper as an offender — for a missing `aria-label` it plainly has. The opening-tag scanner counted `<` and `>` as well as braces, so that a nested `icon={<DismissIcon size={16} />}` would not end the tag early. An arrow function ends it instead: `onClick={() => selectAndFocus(...)}` carries a `>`, and the tag was truncated three props before the label.

**The same walker is in `button.test.ts`**, written in UI-26, with the same bug — silently, because none of its assertions happened to depend on a prop after an arrow function. Both count braces only now. JSX inside a prop is always inside braces, so braces alone answer both cases.

## Validation

Unit 8,884 · browser 641 · lint 0/0 · typecheck clean · no migration. Three mutations on the new guard, all caught: an arrow back on the purchase button, the exception losing its label, and the link losing its mark. Billing rendered and counted — two SVGs left in `main`, and neither is an arrow.

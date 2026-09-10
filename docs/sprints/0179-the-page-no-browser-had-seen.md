# Sprint 0179 — The page no browser had seen

**Date:** 2026-09-08
**Decision:** none. A fixture, a spec, and what the spec found.

## What was asked

Settings — the next item on the founder's list after the auth screens.

## Where the work went, and why not where it looked

The account's settings pages measured better than expected. Headings are ordered on all four (`h1` then `h2`s, no skipped level), and none of them scrolls sideways at 390px. There was no logic defect to find on Products, Repositories, Billing or Profile.

**Project settings was a different story, and the reason is one line:** it had no fixture, so it had never been rendered in a browser test. The route needs a session and a project in Supabase, which the browser suite deliberately has neither of — and every other settings surface had a presentational component a fixture could mount (`ProductsIndex`, `RepositoriesIndex`, `ProfileView`, `BillingView`) while this one had its markup inline in the route.

So the one page carrying **both** of a project's consequential controls — disconnect this repository, delete this product — was the one page no test had ever looked at. CLAUDE.md rule 69 asks four questions before shipping consequential user-visible state; *is the actual browser-visible state tested* was the one it answered no to.

## What rendering it found

Three defects, none of which a source review catches, because each needs two files open at once or a ruler:

**The same sentence, printed twice, one under the other.** The section's paragraph opened *"Vibe works out what your product is on its own."* and `FounderIntentForm`'s own paragraph opened with the identical sentence. Two files, so nobody reading either saw it.

**Deleting the product was the third row of the card headed "Repository."** One `border-t` under Disconnect, both `InlineAction`s with the same icon, distinguished only by their labels. Two of those rows are about a repository and the third destroys the project and everything Vibe has learned about it. The account's own General page states the rule this page broke, in a comment: *"a row above it that looked the same would be a trap."*

**Every card ran to 1080px with its prose stopping at 65ch** — about 580px of nothing between a sentence and the control it describes, and the delete button parked at the far right edge of the card, away from the paragraph explaining what it does.

## What was built

`ProjectSettingsView` holds the markup; the route resolves data and passes it. Two fixtures — connected and disconnected, because the page is a different page without a repository — and `e2e/project-settings.spec.ts`, eight claims.

The duplicate is gone: the section keeps its paragraph and absorbs *every field is optional*; the form drops its lead.

Deleting has its own section, last, after the links — the same treatment the account's delete section gets, and for the same reason it gives. **Not** a coloured card: nothing else in this product marks destruction that way, and the button already carries its own danger tone. It is offered whether or not a repository is connected, which is the other reason it cannot live in a card that disappears with one (ADR 0056 §1).

`SettingsColumn` gives a settings page a measure — 48rem, the width of a 65ch paragraph plus its card's padding — and General, Profile and project settings use it. `AccountShell` keeps its 78rem, because the pages that fill it fill it honestly: Billing is two columns of panels, Repositories a table, Products a grid. Narrowing the shell would have squeezed the three pages that use their width correctly in order to fix the two that did not.

`DeleteProjectButton` aligns to the start rather than the end; `items-end` was written for a `justify-between` row that no longer exists.

## What the guards say

Eight browser claims, on a page that had none. The four load-bearing ones were mutation-tested by restoring the old behaviour — headings back to `h3`, the duplicate paragraph back into the form, the column back to full width, the control back to `items-end` — and exactly four tests failed.

- One heading level under the page title, `h1` then `h2`s.
- The opening sentence appears once.
- The delete section is not inside the Repository card, and is the last section on the page.
- A settings card is at most 768px, and the delete control sits under its own paragraph within 24px of its left edge.
- Both confirmations say the right thing: disconnecting keeps what the project has learned, deleting cannot be undone.
- Without a repository: the connect link is there, nothing offers to disconnect, and deleting survives.
- No horizontal overflow at 1024 or 390.

One locator needed scoping rather than fixing: `No repository connected` appears in the rail's switcher **and** on the card, which is correct in both places.

## What is not done

The account settings pages are unchanged apart from the measure. Billing is long and dense and probably wants a second look, but nothing on it is wrong, and this sprint went where the missing test was.

## Validation

Unit 8,853 · browser 622 · lint 0/0 · typecheck clean · no migration.

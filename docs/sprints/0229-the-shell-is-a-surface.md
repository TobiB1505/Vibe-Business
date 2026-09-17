# Sprint 0229 — The shell is a surface

Slice 7 of [ADR 0109](../decisions/0109-nova-first-application-shell.md), in
half. Fifteen files leave `src/components/layout/` for `src/features/shell/`,
which completes §2's claim that `src/components` is primitives only. **The
navigation itself did not change, and the reason is a decision rather than
effort** — see *Why the navigation waits*.

Nothing a founder sees changed.

## What was wrong

`src/components` is supposed to hold files that **render a shape** (rule 86).
Every file moved here does the opposite: `project-shell.tsx` is the address
table for the whole workspace, `mobile-tab-bar.tsx` knows which sections exist,
`project-switcher.tsx` builds hrefs for four sibling products. Naming a route is
the definition of the line, and these files are made of route names.

They crossed no boundary, which is why the audit's §C.2 let them wait — they
were to be rewritten by the navigation change and moving them twice would be
churn. With that change blocked on a decision (below), waiting meant
`src/components` staying non-primitive indefinitely, so they moved once now and
will be rewritten in place when the navigation arrives.

## What changed

```
src/features/shell/     app-frame, project-shell, project-nav, project-switcher,
                        project-breadcrumb-trail, mobile-tab-bar, account-shell,
                        account-nav, account-card, mobile-account, app-shell,
                        marketing-shell, marketing-header, record-visit, palette-switch
src/components/layout/  atmosphere, auth-shell, settings-column — shapes, naming no route
```

Fifty-seven import sites re-pointed. Six test files that read a shell file **by
path** were re-pointed too, and one rule moved with its subject rather than
being widened: `wallet.test.ts`'s *"a balance in a rail is `Wallet`"* now walks
`src/features/shell/` instead of `src/components/layout/`, because the rails are
what it is about.

## What the boundary test found

**`app-frame.tsx` was classified as a presentation primitive and is not.** §C.2
of the restructure audit listed it under *Presentation primitive*, and the
moment the files it composes moved, `feature-boundaries.test.ts` said
`components → features` twice: it imports `AccountCard` and `MobileAccount`. A
frame that composes the account surface is the signed-in product's shell,
whatever its filename suggests.

Fifteen files moved, not fourteen. The register worked exactly as it is supposed
to — a misclassification in a document became a failing test rather than a
permanent exception.

## Why the navigation waits

ADR 0109 §1 says the app level becomes **Products · New chat · Threads ·
Settings**, and §D's Slice 7 says the phone's tabs become **Nova · Workspace ·
Threads · Account**. Neither shipped.

**A thread is project-scoped.** The audit's §C.9 scopes `nova_threads` to a
project, Slice 5 built it that way, and §E.4 leaves account-level threads open as
a decision nobody has made. So *Threads* at the **account** level names
something that does not exist, and *New chat* asks a question with no answer:
a new chat about which product?

The phone is blocked by the same decision plus its own. §E.5 already asks which
of *Threads* and *Account* is cut, because
[ADR 0108](../decisions/0108-a-phone-is-not-a-narrow-desktop.md)'s four-tab
ceiling admits only four.

Building either would be inventing a product requirement, which is the one thing
this restructure is under instruction not to do (rule 14, and the brief's own
*"if requirements are ambiguous and materially affect product behaviour, stop
and report"*).

**And the workspace pane waits with it.** ADR 0109 §4's pane needs the rail to
shrink, which needs the navigation. The measurement is unchanged from
[Sprint 0226](0226-an-artifact-knows-where-it-is-read.md): at 1280 the project
rail takes 256px and Nova's work column 300 more, leaving the thread about 640.

## What was decided against

- **Adding Threads as a project rail row.** It would be coherent — a thread *is*
  project-scoped — and it is the wrong shape. [ADR 0085](../decisions/0085-nova-is-the-project-home.md)
  forecloses Nova as a rail item because she *is* the project, and a row called
  *Conversation* beside the row called *Nova* is two Novas. The conversation is
  reached from Nova's own column, which is where she is.
- **Guessing at §E.4.** Both answers are defensible and they produce different
  products: project-only threads make the app level *Products · Settings* and
  put the conversation inside a product, while account-level threads make a
  founder's history the spine of the application. That is a product decision
  with a schema consequence, not a detail to infer.

## What has not been proved

- **Nothing was opened in a browser beyond the existing suite.** No file changed
  inside; every change is an address. The browser suite passing unchanged is the
  claim, and it is the right one for a move.
- **`src/components` is primitives only by the register's definition**, which is
  *imports nothing above it*. That is mechanical and true. Whether every file
  left there renders only a shape is a reading, and the reading is that three
  do: `atmosphere.tsx`, `auth-shell.tsx`, `settings-column.tsx`.
- **Node 22 ran the suite; the engine field says 24.**

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 9,748 tests, all passing (unchanged; this slice moved files and
  re-pointed the tests that read them by path).
- `pnpm test:e2e` — 886 passing, unchanged.

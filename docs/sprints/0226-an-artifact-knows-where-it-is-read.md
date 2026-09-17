# Sprint 0226 — An artifact knows where it is read

Slice 4 of [ADR 0109](../decisions/0109-nova-first-application-shell.md): the
workspace artifact registry, and the address it gives every block in Nova's
thread. The pane the slice also named does not fit at 1280 and moves to Slice 7
with the rail that is in its way — measured, not assumed, and recorded in the
audit rather than quietly dropped.

## What was wrong

**A block in the thread was a dead end.** Nova shows the audit reading, the
Move, the prepared change, the scan — composed from the same components the
full-page screens use — and nothing on screen said the product had a page for
any of them. Nine block kinds, zero links. A founder who wanted the whole
diagnosis after reading two lines of it had the rail, and only if they knew
which of seven rows held it.

**And the addresses had no owner.** ADR 0109 §4 says an artifact is a
`{ kind, ref }` resolved by one total record to a read, a view and an address.
None of the three existed: `BLOCK_FOR_MOMENT` said what a moment *shows*, and
nothing said what that thing *is* or where it lives.

## What changed

**`src/features/workspace/` — a registry and a frame, and no views.** That is
the point of the directory. *One view, two frames, and no copies*: the artifact
view **is** the owning feature's view, and eight components already carry a
`presentation` prop for exactly this. A universal renderer would be a second
copy of every screen, drifting from the first.

```
registry/artifacts.ts   ArtifactRef (closed) → segment, read, views; ARTIFACT_FOR_BLOCK
host/artifact-open.ts   an artifact → { href, label }
```

`ArtifactKind` is derived from `ArtifactRef` rather than written beside it, so
the union that names a kind and the union that carries its id cannot disagree.
`ARTIFACT_FOR_BLOCK` is total over `BlockKind` — the same shape and the same
argument as `BLOCK_FOR_MOMENT`: a tenth block kind fails the build until
somebody decides what opening it means.

**Three tables, one direction.** `BLOCK_FOR_MOMENT` → `ARTIFACT_FOR_BLOCK` →
`artifactForEntry`. Each total over the union below it, so a twenty-second
moment cannot silently lose its link. `nova-artifact.test.ts` asserts the chain
against itself rather than against a table of expectations, because a table of
expectations is a fourth copy of the mapping.

**`NovaRenderBlock` gained one optional prop.** `open?: { href, label }`, drawn
in the frame's meta row opposite the label, in the same mono caption at the same
weight — the frame is furniture and the composed surface below it keeps the
emphasis. A `{ href, label }` and not a node, because a component inventing a
URL is the second URL owner Slice 3 spent a slice removing.

**The label is looked up, never written.** `PROJECT_SECTIONS` names the
destinations; the registry holds only the segment. A section renamed without the
registry noticing shows up as the wrong word on a link, and `workspace-host.spec.ts`
is where it shows up.

## What was decided against

- **A `preview` and a `diff` kind.** The audit's §C.7 listed both, and gave both
  the address *"same"* — the prepared change's. A kind whose address is another
  kind's, and whose view is mounted by that other kind's view, is a stage
  `agentStageForChange` picks *within* one change, not an object a founder
  opens. Eight kinds shipped; `prepared_change` names its three stage views.
- **Importing the reads and the views.** `ARTIFACT_SOURCES` names them as text
  and `artifacts.test.ts` checks the text against the files. Importing them
  would pull ten features' server graphs behind any file that wanted one
  address, and would make the registry unusable from a client component — the
  same cost that refused a `commands.ts` barrel in Slice 3.
- **An address on the run in flight.** The moment's block gets one; the block
  below it, showing a run's named stages, does not. A run is an **event, not an
  object**: the page that would open shows what it will produce rather than what
  is happening, and a link to it mid-run promises something that is not there.
- **A link on a moment with no id.** `artifactForEntry` returns `null` when the
  candidate does not carry what the address interpolates. `?plan=undefined` is a
  link to a screen that opens on nothing; no link is the honest version.

## The pane, and why it is Slice 7's

ADR 0109 §4 and the audit's §D both say the artifact is a pane beside the thread
on a desktop. It was measured rather than attempted: at 1280 the project rail is
`lg:w-64` — 256px — and Nova's work column is 300 more, which leaves the thread
about 640. A third column splits that into two unreadable ones, and a prepared
change's review gate at 300px is not a smaller version of that screen, it is a
different one. At 1536 it is 434 each, which is no better for a diff.

What has to move first is the seven-row rail, and moving it is Slice 7's entire
subject. Building a three-column layout now, to be replaced by the slice after
it, is the dead parallel architecture this restructure is under instruction not
to build. So the pane and its below-`lg` bottom sheet ([ADR 0108](../decisions/0108-a-phone-is-not-a-narrow-desktop.md))
move with the rail, and the artifact keeps rendering inline in the thread, which
is where it already was.

Written into the audit as a dated correction (2026-09-17) and into ADR 0109's
status section, so the gap between what was decided and what is built is on the
record rather than in a commit message.

## What was found on the way

**`src/features/README.md` had been false since Slice 1.** Its *What is here*
block listed one directory while thirteen existed. Repaired with the rest:
`account/`, `connect/` and `onboarding/` had no `README.md` and now have one,
and `src/features/operations/` — an empty directory `mkdir -p` made in Slice 3
and git never tracked — is gone. Rule 83 makes a false current-state document a
defect with the standing of a failing test; this one had three slices to be
noticed in.

## What has not been proved

- **The link has not been followed from a real project.** The fixture renders
  the product's thread over the product's ranking, and the addresses are
  asserted as strings against the modules that own them. That the destination
  scrolls to `#prepared-change-<id>` and opens the right stage is guarded by
  `one-loop.spec.ts` and by ADR 0058's own tests, not by this one.
- **Nothing was said about a kind nothing reaches.** `experiment` is in the
  union for its address and no block opens it; the conversation lane is what
  will. It is named here rather than found later.
- **Node 22 ran the suite; the engine field says 24.**

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 545 files, 9,612 tests, all passing (543 / 9,567 before; the
  difference is `artifacts.test.ts` and `nova-artifact.test.ts`).
- Mutation-tested: a segment naming no section, a read symbol that does not
  exist, and a prepared-change address built without its anchor each fail.
- `pnpm test:e2e` — 876 passing, including the six new browser assertions
  (870 before, all of them passing at the same commit beforehand).
- Looked at in a browser at 390 and 1280.

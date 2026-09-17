# Workspace

What Nova is talking about, and where it is read in full. Decided by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) §4,
built in Slice 4.

```
registry/artifacts.ts   ArtifactKind → segment, read, views; and what a block opens
host/artifact-open.ts   an artifact → { href, label }: the way out of the conversation
```

**Nothing here is a view.** That is the point of the directory, not an
omission. _One view, two frames, and no copies_: the artifact view **is** the
owning feature's view — `AuditOverview`, `UnderstandingPanel`, `MoveCard`, the
three Agent stages, `ExperimentCard`, `FounderInputCard` — and eight of them
already carry a `presentation` prop for exactly this. A universal artifact
renderer would be a second copy of every screen, drifting from the first.

`artifacts.ts` holds strings and arithmetic over them, imports no component,
and names its reads and views as text that `artifacts.test.ts` checks. That is
what lets one file answer _where does this open_ from a client component, a
server component or a test, without pulling ten features' server graphs behind
it — the same argument that refused a `commands.ts` barrel in Slice 3.

## What a founder sees today, and what is still missing

The thread's blocks now carry an address: an audit reading says it is read in
**Business Health**, a prepared change in **Agent**, a Move in **Action Plan**.
Before this, no block in the thread linked anywhere at all.

**The pane and the sheet are not here yet.** ADR 0109 §4 says the artifact is a
pane beside the thread on a desktop and a bottom sheet below `lg`. The reason
neither is here is geometry: at 1280 the project rail takes 256px and Nova's
work column 300 more, leaving the thread about 640 — a third column splits that
into two unreadable ones, and a prepared change's review gate at 300px is not a
smaller version of that screen, it is a different one. The rail is what has to
go, and it goes in Slice 7, which is the slice that owns the navigation. Until
then the artifact renders inline in the thread, which is where it already was.

Recorded rather than quietly deferred, because a `host/` holding a link and
claiming to be a pane is the parallel architecture this restructure must not
build.

## What must never happen here

- **No artifact a model composes.** The union is closed and the record is
  total; a kind is added by a person, in this file, with a read and a view that
  already exist.
- **No second URL owner.** Every parameter and fragment comes from the module
  that owns the contract — [ADR 0058](../../../docs/decisions/0058-move-focus-url-contract.md)'s
  `?plan=` and `?change=` from `modules/action-plans/source.ts`, the
  prepared-change anchor and the project path from `src/lib/routing/`.
- **No address invented for a section that does not exist.** Every segment is
  checked against `PROJECT_SECTIONS` and `PROJECT_SUBSECTIONS`; ADR 0109 §7 is
  that every address survives, and a registry is exactly where one would
  quietly stop doing so.
- **Rendering an artifact starts nothing.** Opening one is a read at its own
  address. Every priced operation stays a press with its price shown first
  (rule 60).

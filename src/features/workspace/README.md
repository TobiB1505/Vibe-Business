# Workspace

What Nova is talking about — beside the conversation, and at its own address.
Decided by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) §4: the
addresses in Slice 4, the pane in Slice 7.

```
registry/artifacts.ts        ArtifactKind → segment, read, views; and the two addresses
host/artifact-open.ts        an artifact → { href, label }: the way out of the conversation
host/workspace-pane.tsx      the frame: a name, a way out, and whatever it is given
host/project-workspace-pane.tsx  the same frame with the reads behind it
host/artifact-views.tsx      kind → the owning feature's view, or the reason it is opened instead
```

The **union itself** is [`src/modules/nova/artifacts.ts`](../../modules/nova/artifacts.ts),
beside `blocks.ts` and for the same reason a block kind lives there: a kind is
domain vocabulary — what a message in a thread refers to, what a `CHECK`
enumerates, what a moment resolves to — while _where it is read_ and _what draws
it_ are the product surface. It lived here for one slice, and the thread schema
is what showed the seam.

**Nothing here draws an artifact.** That is the point of the directory, not an
omission. _One view, two frames, and no copies_: the artifact view **is** the
owning feature's view — `AuditBlock`, `UnderstandingPanel`, `MoveBlock`,
`ReviewBlock`, `ExperimentCard` — and each already carries the compact
presentation this needs. `artifact-views.tsx` is a switch that mounts them and
a frame that names them; a universal artifact renderer would be a second copy of
every screen, drifting from the first.

`artifacts.ts` holds strings and arithmetic over them, imports no component,
and names its reads and views as text that `artifacts.test.ts` checks. That is
what lets one file answer _where does this open_ from a client component, a
server component or a test, without pulling ten features' server graphs behind
it — the same argument that refused a `commands.ts` barrel in Slice 3.

## The pane

The workspace is a **query parameter on the conversation's own address** —
`?artifact=<kind>[&ref=<id>]#workspace` on a thread — and not a route. A route
would have replaced the conversation, and _returning to it_ would then have
needed a mechanism: a stored scroll position, a back stack, a remembered
thread. A parameter needs none of that, because the founder never left. The
transcript is the same rendered tree, the composer keeps its draft, and a
founder can send somebody a link to _the thing Nova was talking about_ with the
conversation around it.

Two columns from `lg`, two stacked sections below it.
[ADR 0108](../../../docs/decisions/0108-a-phone-is-not-a-narrow-desktop.md) says
a phone gets a bottom sheet, and this is a section instead — the reason is DOM
rather than taste. A sheet is a `<dialog>` and a column is an `<aside>`, and one
server-rendered artifact cannot be in both without being rendered twice: two
business maps, two sets of ids, two of every control inside a review gate. The
founder reaches it the same way either way, it is deep-linkable, and returning
is scrolling rather than dismissing. What ADR 0108 was protecting against is a
_squeezed column_, and a section at full width is the other honest answer.

Which artifact: the address when it says, otherwise the last thing Nova pointed
at in that thread. A parameter naming a kind that does not exist, or omitting a
reference the address interpolates, resolves to **nothing** rather than to a
guess — `?artifact=opportunity` with no `ref` would open the pane on "a Move"
with no Move.

### Five are drawn, three are named

| Kind              | What the pane does                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `business_health` | `AuditBlock` — the thread's own                                                                                                                       |
| `product`         | `UnderstandingPanel`, with no controls: confirming, correcting and re-scanning are consequential and two are priced                                   |
| `opportunity`     | `MoveBlock`                                                                                                                                           |
| `prepared_change` | `ReviewBlock`, at whatever stage the change is                                                                                                        |
| `experiment`      | `ExperimentCard` for the most recent merged change                                                                                                    |
| `action_plan`     | **named**: a sequence read in order, with a control per step. Three steps of it in a column is not a smaller plan                                     |
| `agent_execution` | **named**: five stages and two live streams. A third of it while the run moves is what a founder would watch instead of the screen built for watching |
| `founder_input`   | **named**: a question belongs to the run paused on it, and it is already the first thing on Nova's own screen when it matters                         |

The three are a decision with a reason rather than a gap, which is why
`artifact-views.tsx` has no `default:` branch: a ninth kind fails the build
until somebody makes the same decision about it.

### Why the frame holds no read

So a browser can see it. Every read here needs a session-scoped Supabase client
and the fixture route the browser suite drives has neither a session nor a
database — a pane that resolved its own artifact could be screenshotted at 390px
by nothing at all, which is rule 69's third question answered with a shrug. It
is also the cost the registry exists to avoid: `artifact-views.tsx` pulls ten
features' server graphs, and the frame must not.

## What must never happen here

- **No artifact a model composes.** The union is closed and the record is
  total; a kind is added by a person, in the module, with a read and a view that
  already exist here.
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

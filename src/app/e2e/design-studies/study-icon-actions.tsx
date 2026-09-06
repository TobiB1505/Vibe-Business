import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/dashboard-icons";
import { DeleteIcon, DismissIcon, EditIcon } from "@/components/ui/icons.generated";
import type { Study } from "./studies";

/**
 * Four ways to let an icon carry the inline action.
 *
 * ## What is being asked
 *
 * The role-split treatment won the first comparison in principle: dismissal is
 * a mark, not a word. This asks the next question — how much the mark says,
 * and when. Every treatment below uses the same three icons, so what is being
 * compared is behaviour rather than draughtsmanship.
 *
 * ## The craft problem at the centre of it
 *
 * An icon that grows into a label is the nicest of these to look at and the
 * only one that breaks a rule the product already holds: `DESIGN.md` requires
 * reserved geometry, because a control that widens pushes whatever follows it
 * sideways while somebody is reading. That is not an objection to the idea —
 * it is a constraint on where it may sit. Treatment 2 is shown twice for
 * exactly this reason: once at the end of a row, where nothing follows and it
 * is free, and once mid-row, where it moves a sibling. The second one is the
 * cost, rendered rather than described.
 *
 * Treatment 4 answers the same wish without the cost, by expanding over the
 * layout instead of inside it.
 *
 * ## Reduced motion
 *
 * Every expansion here is a transition on a grid track, and every one of them
 * is switched off under `prefers-reduced-motion` — the label then simply is or
 * is not there. An animation that only some people can see must still leave
 * everybody with a usable control.
 */

/* ── Shapes ────────────────────────────────────────────────────────── */

/** 32px minimum, because an icon-only control is still a target. */
const HIT = "inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 rounded-nav";
const HOVER_FILL = "transition-interactive hover:bg-surface-hover focus-visible:bg-surface-hover";
const DANGER_FILL =
  "transition-interactive hover:bg-coral-tint-soft focus-visible:bg-coral-tint-soft";

/** Icon alone. The background is the affordance and it costs nothing at rest. */
function IconOnly({ icon, label, danger }: { icon: ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`${HIT} px-1.5 ${
        danger
          ? `text-fg-muted hover:text-coral ${DANGER_FILL}`
          : `text-fg-muted hover:text-fg-body ${HOVER_FILL}`
      }`}
    >
      {icon}
    </button>
  );
}

/**
 * The label grows out of the icon.
 *
 * `grid-template-columns: 0fr → 1fr` rather than a width transition, because a
 * width has to be guessed and a track does not: the label is measured by the
 * browser and the track interpolates to whatever it actually is. The child
 * needs `min-w-0` and `overflow-hidden` or it refuses to be squeezed to zero.
 */
function Expanding({ icon, label, danger }: { icon: ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`group ${HIT} px-1.5 ${
        danger
          ? `text-fg-muted hover:text-coral ${DANGER_FILL}`
          : `text-fg-muted hover:text-fg-body ${HOVER_FILL}`
      }`}
    >
      {icon}
      <span
        className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr] motion-reduce:transition-none"
        aria-hidden
      >
        <span className="min-w-0 overflow-hidden text-ui whitespace-nowrap">
          <span className="pe-1 ps-0.5">{label}</span>
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Both, always. No motion, no surprise, more ink. */
function IconAndLabel({
  icon,
  label,
  danger,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${HIT} px-2 text-ui ${
        danger ? `text-coral ${DANGER_FILL}` : `text-fg-muted hover:text-fg-body ${HOVER_FILL}`
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The label appears beside the icon without occupying layout.
 *
 * Absolutely positioned, so nothing moves. The cost is that it can cover the
 * thing next to it — which is why it is drawn on the surface it floats over
 * rather than as bare text.
 */
function FloatingLabel({
  icon,
  label,
  danger,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className={`peer ${HIT} px-1.5 ${
          danger
            ? `text-fg-muted hover:text-coral ${DANGER_FILL}`
            : `text-fg-muted hover:text-fg-body ${HOVER_FILL}`
        }`}
      >
        {icon}
      </button>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-full mr-1 -translate-y-1/2 rounded-nav border border-line-3 bg-surface-4 px-2 py-1 text-caption whitespace-nowrap text-fg-body opacity-0 transition-interactive peer-hover:opacity-100 peer-focus-visible:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

type Kind = typeof IconOnly;

const TREATMENTS: readonly {
  key: string;
  name: string;
  argument: string;
  cost: string;
  render: Kind;
}[] = [
  {
    key: "icon",
    name: "1 · Nur Icon, Fläche bei Hover",
    argument:
      "The least ink. A round fill arrives under the pointer and under keyboard focus, which is the pattern every current product uses for a dismissal. Nothing moves, ever.",
    cost: "The mark has to be legible on its own. A pencil and a trash can are; a chevron for 'More context' is not, and that role would still need a word.",
    render: IconOnly,
  },
  {
    key: "expand",
    name: "2 · Label wächst aus dem Icon",
    argument:
      "Your idea, and the one that feels most expensive. The icon is the resting state; hover or focus grows the word out of it on a grid track, so the browser measures the label rather than a hard-coded width guessing at it.",
    cost: "It widens, and whatever follows it moves. Safe at the end of a row, wrong in the middle of one — both are rendered below.",
    render: Expanding,
  },
  {
    key: "both",
    name: "3 · Icon und Label, immer",
    argument:
      "The icon carries the role and the word carries the detail, permanently. Nothing is hidden from anyone, on any input, and there is no state to get wrong.",
    cost: "The most ink of the four, on controls that appear sixty-five times. This is the treatment that turns quiet screens busy.",
    render: IconAndLabel,
  },
  {
    key: "float",
    name: "4 · Label schwebt über dem Layout",
    argument:
      "The same reveal as 2, positioned out of flow. The word appears beside the icon and nothing shifts — the wish without the geometry cost.",
    cost: "It can cover its neighbour, so it needs a surface of its own to stay readable. And a label that hides again is still a label a touch user has to discover.",
    render: FloatingLabel,
  },
];

function Row({ treatment }: { treatment: (typeof TREATMENTS)[number] }) {
  const Action = treatment.render;
  return (
    <section className="flex flex-col gap-5 border-t border-line-2 py-8">
      <div>
        <h2 className="text-title font-semibold text-fg">{treatment.name}</h2>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{treatment.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{treatment.cost}</p>
      </div>

      <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
        <dt className="eyebrow text-fg-meta">Verwerfen</dt>
        <dd className="py-1">
          <Action icon={<DismissIcon size={16} />} label="Close" />
        </dd>
        <dt className="eyebrow text-fg-meta">Bearbeiten</dt>
        <dd className="py-1">
          <Action icon={<EditIcon size={16} />} label="Change" />
        </dd>
        <dt className="eyebrow text-fg-meta">Löschen</dt>
        <dd className="py-1">
          <Action icon={<DeleteIcon size={16} />} label="Delete project" danger />
        </dd>
      </dl>

      {/* End of a row: nothing follows, so a widening control is free. */}
      <div className="rounded-card border border-line-3 bg-surface-2 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-fg-meta">Evidence</p>
            <p className="mt-2 text-card-title font-semibold text-fg">
              Your code takes payments and your site offers no way to pay
            </p>
          </div>
          <Action icon={<DismissIcon size={16} />} label="Close" />
        </div>
      </div>

      {/* Mid-row: a sibling follows, so whatever the control does to its own
          width, it does to the layout. This is where treatment 2 costs. */}
      <div className="rounded-panel border border-line-2 bg-surface-1 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow text-fg-meta">Production URL</span>
          <span className="font-mono text-ui text-fg-body">payflow.dev</span>
          <Action icon={<EditIcon size={16} />} label="Change" />
          <span className="text-caption text-fg-disabled">
            ← beobachte, ob dieser Text stehen bleibt
          </span>
        </div>
      </div>
    </section>
  );
}

export function StudyIconActions({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Icon actions</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">How much a mark should say</h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. The icons are Lucide&rsquo;s paths in Vibe&rsquo;s own frame —
          no icon package, no runtime dependency, and the same 1.8 stroke as the thirty-six
          hand-drawn marks. Hover each one; the third block in every treatment is there to show what
          widening costs.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          A chevron for &ldquo;More context&rdquo; is deliberately absent: disclosure is the one
          role a mark alone cannot carry, and it keeps its word in every treatment.{" "}
          <ChevronDownIcon size={13} className="inline align-[-2px]" />
        </p>
      </header>

      {TREATMENTS.map((treatment) => (
        <Row key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}

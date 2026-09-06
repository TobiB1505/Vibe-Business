import type { ReactNode } from "react";
import { creditsToUnits } from "@/modules/credits/units";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { priceDisplayFor } from "@/components/ui/credit-price";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { Study } from "./studies";

/**
 * The Move: three designs for the one control (S0, element track).
 *
 * ## Why this is an element sheet and not another screen
 *
 * The blocked study designed ten situations and produced ten tiles, which is
 * the shape that scales worst: twenty-one moments would be twenty-one
 * layouts. The rhythm the console established — a line, an explanation, a
 * move — is already the layout for all of them. What changes per moment is
 * register and content, not form.
 *
 * So the work is the vocabulary. This sheet designs one word of it.
 *
 * ## Why the current control looks wrong, which is not a matter of taste
 *
 * Every study so far drew the Move as a filled mint block. The chosen
 * direction is *Precision & Light*: opaque panels, bright hairlines, tight
 * corners, **light as a focus tool**. A solid mint slab belongs to Depth &
 * Glass, or to default shadcn. It is off-vocabulary, and that is why it reads
 * as borrowed on a screen built from edges.
 *
 * The second fault is structural. The price sat *beside* the button as its own
 * chip, so one commitment was drawn as two objects — and on `audit_failed` the
 * chip said "Trying again costs" with nothing after it, because
 * `agent_execution` resolves to a silent display. A cost that lives inside the
 * control cannot come apart from it.
 *
 * ## The three
 *
 * **A — The line.** Full measure of the text column, verb left, cost right,
 * one border around both. A row you commit to rather than a pill you click.
 * Cost and action are one object by construction.
 *
 * **B — Weight from light.** Dark surface, one lit edge along the top, mint
 * only as line and label. The direction's own sentence, applied literally: the
 * Move becomes the single element on the screen carrying a light, so emphasis
 * comes from luminance rather than from area of colour.
 *
 * **C — The switch.** One control, internally divided: verb, a rule, then the
 * cost. The division is the mechanic — it reads as a thing with a price
 * attached rather than a button with a caption, and it gives the press
 * somewhere to travel.
 *
 * ## The states are not decoration
 *
 * A Move has four that the product actually produces, and a design that only
 * ever met the priced one will meet the others in production:
 *
 * - **Priced** — a number and the balance behind it.
 * - **Included** — free, and it says so rather than staying silent
 *   ([ADR 0094](../../../../docs/decisions/0094-a-free-operation-says-so.md)).
 * - **Silent** — `agent_execution`, whose cost depends on a pricing class a
 *   surface may not hold. The control must be complete with no cost at all.
 * - **Leaves the product** — reconnecting is the GitHub App flow, and the
 *   control has to say so before the click rather than after it.
 *
 * ## Motion
 *
 * Press is the one interaction here and it belongs to the microinteraction
 * tier: under 120ms, `--ease-emphasis`, no overshoot. Each variant states what
 * moves. Hover is rendered forced in the second row of the sheet, because a
 * still screenshot cannot otherwise show the treatment that separates B.
 */

const BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

/** The four states, as the kinds the product resolves them from. */
type MoveState =
  | { kind: "priced"; operation: RetailOperationKind }
  | { kind: "included"; operation: RetailOperationKind }
  | { kind: "silent"; operation: RetailOperationKind }
  | { kind: "away"; where: string };

const STATES: { state: MoveState; label: string; note: string }[] = [
  {
    state: { kind: "priced", operation: "business_audit" },
    label: "Run the audit again",
    note: "Priced — the number and the balance behind it.",
  },
  {
    state: { kind: "included", operation: "product_understanding" },
    label: "Read my product again",
    note: "Free, and it says so rather than staying silent.",
  },
  {
    state: { kind: "silent", operation: "agent_execution" },
    label: "Build it",
    note: "Cost depends on a pricing class this surface does not hold. The control must be complete without one.",
  },
  {
    state: { kind: "away", where: "Takes you to GitHub" },
    label: "Reconnect your repository",
    note: "Leaves the product. Said before the click.",
  },
];

/** Whether a cost will actually render, asked the way the component asks it. */
function hasCost(state: MoveState): boolean {
  if (state.kind === "away") return false;
  return priceDisplayFor(state.operation).kind !== "silent";
}

function Cost({ state }: { state: MoveState }) {
  if (state.kind === "away") {
    return <span className="text-caption text-fg-meta">{state.where}</span>;
  }
  return <CostDisclosure operation={state.operation} balance={BALANCE} />;
}

/* ── A — The line ─────────────────────────────────────────────────────── */

/**
 * Full measure, verb left, cost right, one border.
 *
 * The whole row is the control, so a founder cannot press the action without
 * the price being in the same rectangle their eye is already in. Where there
 * is no cost the row keeps its shape and the right side simply ends — the
 * geometry does not depend on the state, which is what stops a Move from
 * changing size as a project changes.
 */
function MoveLine({ state, label }: { state: MoveState; label: string }) {
  return (
    <span className="move-line flex w-full items-center justify-between gap-4 rounded-nav border border-mint-line bg-mint-tint-soft px-4 py-3">
      <span className="text-ui font-semibold text-mint">{label}</span>
      <Cost state={state} />
    </span>
  );
}

/* ── B — Weight from light ────────────────────────────────────────────── */

/**
 * A dark surface with one lit edge, and mint only as line and label.
 *
 * The direction's sentence taken literally. `study-nova-home` already uses a
 * single directional band to say *this one* about the focused card; the Move
 * is the other place a screen has exactly one of something, so it can carry
 * the same device at control scale without spending the emphasis twice — the
 * card's band and the Move's are never both on screen in the same region.
 *
 * On hover the band brightens and widens to the full edge. Nothing moves
 * position, so there is no reflow and nothing to reserve.
 */
function MoveLit({ state, label }: { state: MoveState; label: string }) {
  return (
    <span className="move-lit relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-nav border border-line-3 bg-surface-2 px-4 py-3">
      <span
        aria-hidden
        className="move-lit-band pointer-events-none absolute inset-x-0 top-0 h-px"
      />
      <span className="text-ui font-semibold text-mint">{label}</span>
      <Cost state={state} />
    </span>
  );
}

/* ── C — The switch ───────────────────────────────────────────────────── */

/**
 * One control, internally divided: verb, a rule, the cost.
 *
 * The division is the point — it reads as a thing with a price attached rather
 * than as a button with a caption beside it, and the rule gives the press
 * somewhere to travel: the verb half depresses while the cost half holds, so
 * the control has a visible mechanic rather than a uniform scale.
 *
 * Where there is no cost the rule and the second half are absent, and the
 * control collapses to its verb rather than rendering an empty compartment. A
 * divider with nothing after it is the same defect as the dangling "Trying
 * again costs" label the blocked study produced.
 *
 * `w-fit` and `justify-self-start` are load-bearing rather than tidy. A grid
 * cell stretches its child by default, so the first render gave every switch
 * the full column width and drew exactly the empty compartment the paragraph
 * above says it must not have — including on `Build it`, where the code had
 * correctly decided not to render a cost at all.
 */
function MoveSwitch({ state, label }: { state: MoveState; label: string }) {
  const showsCost = hasCost(state) || state.kind === "away";

  return (
    <span className="move-switch inline-flex w-fit items-stretch justify-self-start overflow-hidden rounded-nav border border-mint-line">
      <span className="move-switch-verb bg-mint-tint px-4 py-3 text-ui font-semibold text-mint">
        {label}
      </span>
      {showsCost && (
        <span className="flex items-center border-l border-mint-line bg-surface-2 px-4 py-3">
          <Cost state={state} />
        </span>
      )}
    </span>
  );
}

/* ── The sheet ────────────────────────────────────────────────────────── */

const VARIANTS = [
  {
    id: "a",
    name: "The line",
    thesis: "Full measure. Cost and action are one object by construction.",
    press: "The whole row settles 1px and its fill lifts a step.",
    Move: MoveLine,
  },
  {
    id: "b",
    name: "Weight from light",
    thesis: "Dark surface, one lit edge. Emphasis from luminance, not from area of colour.",
    press: "The band brightens to full and the surface lifts a step. Nothing moves position.",
    Move: MoveLit,
  },
  {
    id: "c",
    name: "The switch",
    thesis: "Verb, a rule, the cost. The division is the mechanic.",
    press: "The verb half depresses while the cost half holds.",
    Move: MoveSwitch,
  },
] as const;

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

export function StudyMove({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Label>Element</Label>
          <p className="text-title font-semibold text-fg">The Move, three ways</p>
        </div>
        <p className="study-measure text-caption text-fg-prose">
          Not a screen. One word of the vocabulary, in the four states the product actually
          produces, so the shape is chosen against all of them rather than against the friendly one.
        </p>
        <p className="study-measure text-caption text-fg-secondary">
          The filled mint block every study used until now is off-vocabulary: the chosen direction
          spends its contrast on edges and light, and a solid slab of accent belongs to a different
          one. The price also sat beside the control as its own chip, so one commitment was drawn as
          two objects.
        </p>
      </div>

      {VARIANTS.map((variant) => (
        <section
          key={variant.id}
          className="flex flex-col gap-4"
          aria-labelledby={`move-${variant.id}`}
        >
          <div className="flex flex-col gap-1.5">
            <Label>
              <span id={`move-${variant.id}`}>
                {variant.id.toUpperCase()} — {variant.name}
              </span>
            </Label>
            <p className="study-measure text-ui text-fg-body">{variant.thesis}</p>
            <p className="study-measure text-caption text-fg-meta">Press: {variant.press}</p>
          </div>

          <div className={`flex flex-col divide-y divide-line-1 ${panel}`}>
            {STATES.map(({ state, label, note }) => (
              <div
                key={label}
                className="grid gap-4 p-5 sm:grid-cols-[minmax(0,22rem)_1fr] sm:items-center"
              >
                <variant.Move state={state} label={label} />
                <p className="text-caption text-fg-secondary">{note}</p>
              </div>
            ))}
          </div>

          {/*
            Hover, forced. The treatment that separates B is a lit edge that a
            still screenshot cannot otherwise show, and comparing three
            variants on their resting state alone would be comparing two
            thirds of each of them.
          */}
          <div className={`flex flex-wrap items-center gap-4 p-5 ${panel}`}>
            <Label>Hover</Label>
            <span className="force-hover inline-flex w-full max-w-[22rem]">
              <variant.Move state={STATES[0].state} label={STATES[0].label} />
            </span>
          </div>
        </section>
      ))}
    </div>
  );
}

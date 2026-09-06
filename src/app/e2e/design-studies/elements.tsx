import type { CSSProperties, ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { priceDisplayFor } from "@/components/ui/credit-price";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * The design system's vocabulary, as elements rather than as screens.
 *
 * ## Why this file exists
 *
 * Because the alternative was found not to scale. `study-blocked` designed ten
 * situations and produced ten tiles; twenty-one moments would have produced
 * twenty-one layouts, each with its own copy of a button. The rhythm the
 * console study established — a line, an explanation, a move — is already the
 * layout for every moment the product has. What changes between them is
 * register and content.
 *
 * So the work is to define each word once, here, and let the studies pour
 * content into it. A study that hand-rolls its own control is a study whose
 * findings do not transfer.
 *
 * This is lab code: it lives under `design-studies/`, is reachable only
 * through the fixture route, and nothing in `/app` imports it. What earns its
 * place here graduates to `src/components/` later, deliberately.
 */

/* ── The Move ─────────────────────────────────────────────────────────── */

/**
 * The one action a moment offers, with its cost inside it.
 *
 * ## Which design this is, and why
 *
 * Variant **B** from `study-move`, chosen at review: a dark surface with one
 * lit edge, mint as line and label only. The three were compared in all four
 * states, and B is the one whose resting state carries no area of accent —
 * emphasis comes from luminance, which is the chosen direction's own sentence
 * rather than a preference. The filled mint block every earlier study used
 * belongs to a direction that was not chosen.
 *
 * ## The cost is inside, not beside
 *
 * A price rendered next to a control is two objects for one commitment, and
 * the blocked study proved the failure mode: its separate chip printed "Trying
 * again costs" with nothing after it, because `agent_execution` resolves to a
 * silent display. Here the cost is a child, so it cannot come apart from the
 * thing it prices, and an absent cost simply leaves the row's right side
 * empty rather than leaving a label stranded.
 *
 * ## Geometry does not depend on state
 *
 * The row is full measure in every state. A Move that shrank when its price
 * disappeared would change size as a project changed, which is the reflow the
 * motion obligations exist to prevent — and it would make the priced and free
 * versions of the same decision look like different kinds of thing.
 */
export function Move({
  label,
  operation = null,
  balance,
  /** Where it goes, when pressing leaves the product. Said before the click. */
  leavesTo,
  className,
}: {
  label: string;
  /** The retail kind this charges under. Null when free or unpriced. */
  operation?: RetailOperationKind | null;
  balance?: CostBalance | null;
  leavesTo?: string;
  className?: string;
}) {
  return (
    <span
      className={`move-lit relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-nav border border-line-3 bg-surface-2 px-4 py-3 ${className ?? ""}`}
    >
      {/*
        The control's only light. A hairline at partial width at rest, reaching
        the full edge on hover — nothing moves position, so there is no reflow
        and nothing to reserve.
      */}
      <span
        aria-hidden
        className="move-lit-band pointer-events-none absolute inset-x-0 top-0 h-px"
      />
      <span className="text-ui font-semibold text-mint">{label}</span>
      {leavesTo ? (
        <span className="shrink-0 text-caption text-fg-meta">{leavesTo}</span>
      ) : (
        <CostDisclosure operation={operation} balance={balance} />
      )}
    </span>
  );
}

/**
 * Whether a Move will actually show a cost, asked the way the component asks
 * it.
 *
 * Exported because callers sometimes need to know *before* laying out — a
 * heading that says "this costs" is a dangling label when the answer is no.
 * `priceDisplayFor` is the same function `CostDisclosure` consults, so the two
 * can never disagree.
 */
export function moveShowsCost(operation: RetailOperationKind | null): boolean {
  if (operation === null) return false;
  return priceDisplayFor(operation).kind !== "silent";
}

/* ── The Bubble ───────────────────────────────────────────────────────── */

/**
 * What Nova says, and the container everything else sits in.
 *
 * ## Why this replaced the Line's registers
 *
 * The first attempt put the register *inside* the sentence: a coloured rule at
 * the text's left edge, four ways. It was rejected on sight, and the reason it
 * deserved to be is that a rule beside a paragraph is a document grammar —
 * a pull quote, a blockquote, a changebar. This surface is not a document. It
 * is somebody speaking, and the wireframe says so: every line of text sits in
 * a bubble that arrives.
 *
 * A bubble already carries its own nature, so the register belongs to it. That
 * is the whole move, and it is why `Line` and `Context` below are now plain
 * text with no markers of their own.
 *
 * ## The register is two axes, and neither is chosen here
 *
 * Both come from `statusForCandidate`, so a bubble cannot describe a moment
 * differently from the pill beside it:
 *
 * - **`tone`** — what kind of thing this is. Coral wrong, amber your turn,
 *   mint available, neutral a plain fact.
 * - **`open`** — whether a loop is still hanging. Drawn as a dashed contour.
 *
 * The second axis is the fix for a defect the first design had. A stalled run
 * was drawn amber where a failed one was coral, which reads as *less bad* when
 * the domain was saying *less certain* — a different claim entirely. Coral and
 * dashed says both halves: something is wrong, and it is not over.
 *
 * ## What survives with the colour removed
 *
 * `DESIGN.md` says colour is never the only signal. Four appearances survive
 * greyscale — hairline solid, hairline dashed, double solid, double dashed —
 * and they carry the distinctions that matter when somebody is scanning rather
 * than reading: *something is wrong*, *nothing has concluded*, *neither*.
 * Within "nothing is wrong", available and waiting-on-you are separated by hue
 * and by the word, and the sheet says that rather than claiming more.
 *
 * ## Geometry
 *
 * A bubble hugs its content up to a reading measure, the way every chat a
 * founder has ever used does — a three-word remark should not be a banner. The
 * exception is a bubble carrying a Move: a decision takes the full measure,
 * because the Move's own rule is that its geometry never depends on its state,
 * and a control that changed width with the length of the sentence above it
 * would break that from the outside.
 */
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bubble-neutral",
  active: "bubble-active",
  success: "bubble-active",
  waiting: "bubble-waiting",
  problem: "bubble-problem",
};

const TONE_TINT: Record<StatusTone, string> = {
  neutral: "text-fg-meta",
  active: "text-mint",
  success: "text-mint",
  waiting: "text-amber",
  problem: "text-coral",
};

export function Bubble({
  children,
  /** What kind of thing this is. From `statusForCandidate(...).tone`. */
  tone = "neutral",
  /** Whether a loop is hanging. From `statusForCandidate(...).open`. */
  open = false,
  /**
   * Something also true, never something to do. A bubble with no walls, and no
   * tail — nobody is being spoken to, so nothing points at a speaker.
   */
  aside = false,
  /** The status word, from `statusForCandidate`. Never written at a call site. */
  eyebrow,
  /**
   * Whether this one points at the speaker. Only the first of a run does, the
   * way a phone does it — a tail on every bubble in a group reads as four
   * people talking at once.
   */
  tail = true,
  /**
   * Fill the reading measure rather than hugging. True whenever a Move is
   * inside — and it is the *measure*, never the column: at a thread's full
   * width the control inside became a seven-hundred-pixel button, which is a
   * bubble that stopped being a bubble.
   */
  wide = false,
  /** Stagger position, so a thread arrives in order rather than at once. */
  index = 0,
}: {
  children: ReactNode;
  tone?: StatusTone;
  open?: boolean;
  aside?: boolean;
  eyebrow?: string;
  tail?: boolean;
  wide?: boolean;
  index?: number;
}) {
  const hasTail = tail && !aside;

  return (
    <div
      className={`bubble bubble-arrive ${aside ? "bubble-aside" : TONE_CLASS[tone]} ${
        open && !aside ? "bubble-open" : ""
      } ${hasTail ? "bubble-tailed" : ""} ${wide ? "w-full" : "w-fit"} max-w-[46ch] ${
        aside ? "px-1 py-1" : "px-4 py-3.5"
      } flex min-w-0 flex-col gap-2`}
      style={{ "--i": index } as CSSProperties}
    >
      {hasTail && <BubbleTail />}
      {eyebrow && (
        <p
          className={`text-label font-mono tracking-[0.16em] uppercase ${
            aside ? TONE_TINT.neutral : TONE_TINT[tone]
          }`}
        >
          {eyebrow}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * The tail, drawn rather than faked.
 *
 * Two paths, and the order matters. The **fill** overlaps the body by two
 * pixels, which is what hides the body's own left border across the joint —
 * and it only hides it because the register fills are opaque. The **stroke**
 * then runs the two edges that are genuinely outside: the top, collinear with
 * the bubble's top border, and the diagonal, which stops at the bubble's left
 * edge so the bubble's own border continues the line downward. The third edge
 * is interior and must never be drawn.
 *
 * Both read the register's custom properties, so a dashed bubble gets a dashed
 * tail and a 2px bubble a 2px one, without either side knowing about the other.
 */
function BubbleTail() {
  return (
    <svg
      aria-hidden
      className="bubble-tail"
      width="11"
      height="12"
      viewBox="0 0 11 12"
      fill="none"
    >
      <path d="M11 0.5 L0 0.5 L11 12 Z" fill="var(--bubble-fill)" />
      <path
        d="M11 0.5 L0 0.5 L9.5 10.4"
        stroke="var(--bubble-line)"
        strokeWidth="var(--bubble-width)"
        strokeDasharray="var(--bubble-dash)"
        strokeLinecap="butt"
      />
    </svg>
  );
}

/* ── The Line and the Context ─────────────────────────────────────────── */

/**
 * What Nova says. One sentence, at reading weight rather than display weight.
 *
 * Deliberately unadorned. It carried the register until the bubble took it
 * over, and everything it used to draw — an eyebrow, a rule, a tint — now
 * belongs to the container. A sentence that has to mark itself is a sentence
 * in the wrong box.
 */
export function Line({ children }: { children: ReactNode }) {
  return <p className="text-title font-semibold text-balance text-fg">{children}</p>;
}

/** The explanation under a Line. Quieter, and never a box of its own. */
export function Context({ children }: { children: ReactNode }) {
  return <p className="study-measure text-caption text-fg-secondary">{children}</p>;
}

/* ── The Header ───────────────────────────────────────────────────────── */

/**
 * Whether Nova is available at all.
 *
 * Not derived, and deliberately so. Every other state on this screen is a
 * reading of what the product observed; this one is an operator switch, and it
 * answers a question none of the derived states can: *is the service up*. A
 * founder who arrives during maintenance needs to be told that before they
 * read anything else, and no amount of focus ranking says it.
 *
 * `online` is the resting state and carries no explanation. `offline` carries
 * one, because a product that goes quiet without saying why is a product the
 * founder assumes is broken.
 */
export type NovaAvailability = { state: "online" } | { state: "offline"; because: string };

/**
 * The chat header — who you are talking to, and whether they are there.
 *
 * ## Why this is the one piece of glass
 *
 * The direction spends glass on chrome and keeps it off the surfaces text sits
 * on, because `backdrop-filter` under a scrolling list is what makes a product
 * judder. A header is chrome by definition: it does not scroll, it holds no
 * dense data, and it is the frame the thread moves behind. So it is where the
 * material actually gets to be seen.
 *
 * ## Why the dot does not pulse
 *
 * Because it would be the first thing on the screen to read as *she is doing
 * something*, and it is not saying that — it is saying the service is
 * reachable. The work state lives beside the mark in the rail and has its own
 * word. A breathing dot here would be a claim about activity nobody observed,
 * which is the one thing `DESIGN.md` calls a lie rather than a style.
 *
 * ## Why the word is always rendered
 *
 * A green dot alone is a colour carrying a state, which this design system
 * does not do anywhere else and will not start doing in its most visible row.
 */
export function Header({
  availability,
  /** What this conversation is about. The project's own name, never Nova's. */
  subject,
  /** The mark, passed in so this element never decides which state it is in. */
  mark,
}: {
  availability: NovaAvailability;
  subject: string;
  mark: ReactNode;
}) {
  const online = availability.state === "online";

  return (
    <header className="study-glass study-glass-sheen sticky top-0 z-10 flex items-center gap-3.5 rounded-panel px-4 py-3">
      {mark}
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-semibold text-fg">Nova</p>
        <p className="flex items-center gap-1.5 truncate text-caption text-fg-meta">
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${online ? "bg-mint" : "bg-fg-disabled"}`}
          />
          {online ? "Online" : `Offline — ${availability.because}`}
        </p>
      </div>
      <span className="shrink-0 truncate text-caption text-fg-meta max-sm:hidden">{subject}</span>
    </header>
  );
}

/* ── The past ─────────────────────────────────────────────────────────── */

/**
 * Something that happened, with the time it happened at.
 *
 * ## Why this is not a bubble
 *
 * Because a tail means *somebody is saying this now*, and nothing here is
 * being said. These are rows the product wrote when it acted — `audit_events`
 * through `buildActivityFeed` — and they were already true before the founder
 * opened the page.
 *
 * That is also the answer to whether Nova's sentences carry timestamps. **They
 * do not, and these do.** A logged event happened at a moment and the row
 * records it; Nova's present-tense sentence is re-derived every time the page
 * loads, so "sent at 14:47" would be a fact about a render rather than about
 * anything that occurred. Time appears exactly where there is a time.
 *
 * ## Why the past is not stored as Nova's words
 *
 * The obvious way to give this surface a history is to append her sentences to
 * a table as she says them. It is the wrong way: her sentences describe the
 * present, so yesterday's *"There is a change waiting for you to look at"* is
 * simply false today, and a transcript that replays it is a screen lying about
 * the past in the founder's own scrollback.
 *
 * The event log has none of that problem. It records what *occurred*, which
 * stays true, and its labels are already written in the product's voice. So
 * the past is the log and the present is the projection — two readings, one
 * persisted source each, and neither can drift from the other.
 */
export function Happened({
  title,
  at,
  tone = "neutral",
  facts,
}: {
  title: string;
  /** Already formatted by the caller. This element does no clock arithmetic. */
  at: string;
  tone?: "success" | "waiting" | "problem" | "neutral";
  facts?: { label: string; value: string }[];
}) {
  const dot =
    tone === "success"
      ? "bg-mint"
      : tone === "waiting"
        ? "bg-amber"
        : tone === "problem"
          ? "bg-coral"
          : "bg-fg-disabled";

  return (
    <div className="flex items-start gap-3 py-1.5">
      <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-caption text-fg-secondary">{title}</p>
        {facts && facts.length > 0 && (
          <p className="truncate font-mono text-caption text-fg-meta">
            {facts.map((fact) => `${fact.label} ${fact.value}`).join("  ·  ")}
          </p>
        )}
      </div>
      <span className="shrink-0 font-mono text-caption text-fg-meta tabular-nums">{at}</span>
    </div>
  );
}

/**
 * The line that says where the founder got to.
 *
 * ## Why this is the piece that had to be invented
 *
 * Everything else on this screen already survives a reload, because all of it
 * is derived from rows: the operations, the prepared changes, the plan, the
 * events. A founder who comes back tomorrow is looking at exactly the state
 * they left. What they cannot tell is **which of it is new**, and no amount of
 * derivation answers that — it is a fact about a person, not about a project.
 *
 * So it is the one thing the product has to remember on their behalf: the last
 * moment they looked. One timestamp per founder per project, read here and
 * written when the page is opened.
 *
 * It is deliberately a *divider* and not a badge. A count would have to be
 * right, and "3 new" over a list somebody already scrolled past is worse than
 * nothing; a line simply marks a place, and a founder who reads past it has
 * lost nothing.
 */
export function SinceDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2" role="separator">
      <span aria-hidden className="h-px flex-1 bg-line-2" />
      <span className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">
        {children}
      </span>
      <span aria-hidden className="h-px flex-1 bg-line-2" />
    </div>
  );
}

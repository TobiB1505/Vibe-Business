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
 *
 * ## Two layouts, and why the second one exists
 *
 * `row` puts the cost beside the label and is right for a single control at
 * reading width. `tile` stacks them, which is what lets three of them stand
 * side by side without any of them wrapping — and wrapping was the whole
 * failure of the first side-by-side attempt: a priced control broke onto two
 * lines beside a free one and the row stopped being a row.
 *
 * A tile is taller and narrower on purpose. Three tiles fill the block they
 * sit under rather than stacking a column that grows with every option.
 */
export function Move({
  label,
  operation = null,
  balance,
  /** Where it goes, when pressing leaves the product. Said before the click. */
  leavesTo,
  /** `tile` stacks the cost under the label, so three can stand side by side. */
  layout = "row",
  className,
}: {
  label: string;
  /** The retail kind this charges under. Null when free or unpriced. */
  operation?: RetailOperationKind | null;
  balance?: CostBalance | null;
  leavesTo?: string;
  layout?: "row" | "tile";
  className?: string;
}) {
  const tile = layout === "tile";

  return (
    <span
      className={`move-lit relative flex w-full overflow-hidden rounded-nav border border-line-3 bg-surface-2 ${
        tile
          ? // A tile on a wide screen and a row on a phone. Three tiles in one
            // column is three short controls with an empty line under each,
            // which is the shape the stacking was meant to avoid.
            "min-h-[5.25rem] flex-col justify-between gap-2 px-4 py-3.5 max-sm:min-h-0 max-sm:flex-row max-sm:items-center max-sm:gap-4 max-sm:px-4 max-sm:py-3"
          : "items-center justify-between gap-4 px-4 py-3"
      } ${className ?? ""}`}
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
      <span className={`text-ui font-semibold text-mint ${tile ? "text-balance" : ""}`}>
        {label}
      </span>
      {/*
        A tile always reserves the second line, priced or not. Three tiles whose
        heights depended on whether each one cost something would be three
        different sizes of decision on one row, which is the thing a row of
        equals is for saying they are not.
      */}
      <span className={tile ? "min-h-[1.25rem] max-sm:min-h-0" : "contents"}>
        {leavesTo ? (
          <span className="shrink-0 text-caption text-fg-meta">{leavesTo}</span>
        ) : (
          <CostDisclosure operation={operation} balance={balance} />
        )}
      </span>
    </span>
  );
}

/**
 * The moves a moment offers, side by side.
 *
 * ## Three, and never four
 *
 * A cap rather than a scroll or a wrap. Past three the row stops being
 * scannable and starts being a menu, and a founder reading a thread is not
 * shopping. The ranking is `deriveNovaFocus`'s, so the three shown are the
 * three it put first — this renders a decision that was already made rather
 * than making one.
 *
 * Nothing is hidden by the cap: the rail lists everything open, with the same
 * words, which is the surface built for the full set. A thread shows what to
 * do next; a list shows what there is.
 *
 * ## Why they are tiles, and why one is not
 *
 * So none of them wraps. The first side-by-side attempt used rows and a priced
 * control broke onto two lines beside a free one, which made a spend and a
 * navigation read as two different sizes of thing. Stacked, they are one shape
 * at one height, and three of them fill the width of the block above.
 *
 * A lone move is a row instead. The tile shape exists so that several controls
 * can stand beside each other at one height; one has nothing to stand beside,
 * and rendering it as a tile leaves a third of the width taken by a control
 * with an empty line under it. Most of the twenty-one moments offer exactly
 * one move, which is where that showed.
 */
export function Moves({
  moves,
  balance,
}: {
  moves: readonly {
    label: string;
    operation?: RetailOperationKind | null;
    leavesTo?: string;
  }[];
  balance?: CostBalance | null;
}) {
  const shown = moves.slice(0, 3);
  const [only] = shown;
  if (!only) return null;

  if (shown.length === 1) {
    return (
      <div className="max-w-[24rem]">
        <Move
          label={only.label}
          operation={only.operation ?? null}
          leavesTo={only.leavesTo}
          balance={balance}
        />
      </div>
    );
  }

  return (
    <div
      className={`grid gap-2.5 max-sm:grid-cols-1 ${
        shown.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"
      }`}
    >
      {shown.map((move) => (
        <Move
          key={move.label}
          label={move.label}
          operation={move.operation ?? null}
          leavesTo={move.leavesTo}
          balance={balance}
          layout="tile"
        />
      ))}
    </div>
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
 * ## A bubble is speech, and only speech
 *
 * Nothing executable goes inside one. A bubble exists to show that Nova is
 * *saying* something; a Move is something the founder can *do*, and putting a
 * button in a speech bubble makes those one object when they are two. The
 * question goes in the bubble and the control sits under it, unwrapped.
 *
 * The first draft had a `wide` prop that existed solely to hold a Move, which
 * is the shape of the mistake showing through the API.
 *
 * ## Geometry
 *
 * A bubble hugs its content up to a reading measure, the way every chat a
 * founder has ever used does — a three-word remark should not be a banner.
 *
 * It may hold more than one paragraph, and `speech.ts` decides when: short
 * lines stay several bubbles, prose becomes one. The gap between children is
 * a paragraph break rather than a list gap, which is why it is larger than the
 * spacing between bubbles — inside one utterance the sentences belong closer
 * to each other than two utterances do, and only the container says so.
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
   * Something also true, never something to do.
   *
   * Still a bubble — quieter, and without the moment's register, because four
   * coloured contours down one thread is four claims where the product is
   * making one.
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
  /** Stagger position, so a thread arrives in order rather than at once. */
  index = 0,
}: {
  children: ReactNode;
  tone?: StatusTone;
  open?: boolean;
  aside?: boolean;
  eyebrow?: string;
  tail?: boolean;
  index?: number;
}) {
  const hasTail = tail && !aside;

  return (
    <div
      className={`bubble bubble-arrive ${aside ? "bubble-neutral" : TONE_CLASS[tone]} ${
        open && !aside ? "bubble-open" : ""
      } ${hasTail ? "bubble-tailed" : ""} flex w-fit min-w-0 max-w-[46ch] flex-col gap-2.5 px-3.5 py-2.5`}
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
 *
 * The outer edge is a curve rather than a straight hypotenuse. A triangle is
 * what a wedge looks like; a tail is what a drop of something looks like as it
 * leaves the shape, and the difference is the whole reason the first version
 * read as a spike glued to a card.
 */
/**
 * A block's frame by register.
 *
 * Only a claim gets a colour. A block that shows what Vibe made is furniture
 * and takes the neutral panel; a block that asks something of the founder is a
 * status, and takes the amber the panel inside it gave up.
 */
const BLOCK_TONE: Record<StatusTone, string> = {
  neutral: "border-line-2 bg-surface-1",
  active: "border-line-2 bg-surface-1",
  success: "border-line-2 bg-surface-1",
  waiting: "border-amber-line bg-amber-tint-soft",
  problem: "border-coral-line bg-coral-tint-soft",
};

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
      <path d="M11 0.5 L1.5 0.5 Q0 0.6 0.6 2 Q3 6.6 11 12 Z" fill="var(--bubble-fill)" />
      <path
        d="M11 0.5 L1.5 0.5 Q0 0.6 0.6 2 Q3 6.6 9.5 10.4"
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
 *
 * ## Why it is not display weight any more
 *
 * It was `text-title` and semibold, which made the leading sentence a headline
 * and every sentence after it look like the body copy underneath one. A chat
 * has no headline. Every message in the reference is the same size and the
 * same weight, and the difference between them is which bubble they are in —
 * which is exactly the job this design already gave the container.
 */
export function Line({ children }: { children: ReactNode }) {
  return <p className="text-ui text-fg">{children}</p>;
}

/** A quieter sentence. Same size as a Line — only the colour steps back. */
export function Context({ children }: { children: ReactNode }) {
  return <p className="text-ui text-fg-secondary">{children}</p>;
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
 *
 * ## The clock
 *
 * The founder's own, from their browser. It is the one number on the screen
 * that is not about the project, and it is here for the same reason a phone
 * puts it in the status bar: everything else on this surface is relative
 * — *32m ago*, *while you were away* — and a relative time is unreadable
 * without an absolute one somewhere in view.
 *
 * ## Why the project is up here and not at the foot of the rail
 *
 * Because this row is the status row, and a repository connection is a
 * status — the one `focus.ts` calls "the precondition for everything else
 * Nova could say", which is why `source_disconnected` outranks every other
 * candidate rather than joining the queue. At the foot of the rail it was a
 * name with a subtitle, sitting under a wallet and a profile, saying nothing
 * about whether the thing it named still worked.
 *
 * Connected is a fact the product observes, not a decoration: it is the same
 * `sourceDisconnected` the ranking reads. When it goes false the header says
 * so before the founder reads a single sentence below it.
 */
export function Header({
  availability,
  /** What this conversation is about. The project's own name, never Nova's. */
  subject,
  /** Whether the repository behind that name is still reachable. */
  connected,
  /**
   * The moment before that is known, on the one screen that has one.
   *
   * Everywhere else this state does not exist: a page renders with the answer
   * already read. The opening is the exception, and it needs its own word —
   * "Disconnected" in coral for the second before the first read returns would
   * be the product alarming a founder about nothing.
   */
  connecting = false,
  /** The mark, passed in so this element never decides which state it is in. */
  mark,
  /** The viewer's clock. Passed in, because only a client component has one. */
  now,
}: {
  availability: NovaAvailability;
  subject: string;
  connected: boolean;
  connecting?: boolean;
  mark: ReactNode;
  now?: ReactNode;
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
      {/*
        One line, not two. Stacked, the project and its connection read as a
        name with a caption under it and left the status row half empty; side
        by side they read as one fact — *this project, and it is reachable* —
        and they give the row something to hold.
      */}
      <div className="flex min-w-0 shrink-0 items-center gap-2.5 max-sm:hidden">
        <span className="truncate text-caption text-fg-secondary">{subject}</span>
        <span aria-hidden className="h-3 w-px shrink-0 bg-line-3" />
        <span className="flex shrink-0 items-center gap-1.5 text-caption text-fg-meta">
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              connecting ? "study-pulse bg-fg-muted" : connected ? "bg-mint" : "bg-coral"
            }`}
          />
          {connecting ? "Connecting…" : connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      {now}
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
 * What Nova is doing, said the way a chat product says it.
 *
 * ## What this replaced, and why the box had to go
 *
 * A labelled well reading "RIGHT NOW / Reading what you built". Two problems,
 * and the second is the real one. It was a container around a single line,
 * which is a card for a sentence. And above it sat the word "Working" — a
 * state the mark beside it was already showing, spelled out again in case the
 * mark did not work. If the mark does not work, the fix is the mark.
 *
 * ## What it may say, and what it may never say
 *
 * `OPERATION_STAGE_LABELS[stage]` — the stage the executor actually wrote to
 * the operation row. That is a record of what Vibe *did*, and it is the only
 * thing allowed here. Rule 43 forbids rendering model reasoning, and this is
 * precisely the element a founder would most enjoy having lie to them: a
 * stream of sentences a model wrote about its own thinking is the version of
 * this that reads best and is not allowed.
 *
 * So the shimmer is on a sentence the product can stand behind, and the
 * sentence stays legible with the shimmer gone.
 */
export function Thinking({ children }: { children: ReactNode }) {
  return (
    <p
      className="study-thinking study-measure text-center text-ui font-medium"
      /* Announced as a state, not as a moving gradient. */
      role="status"
    >
      {children}
    </p>
  );
}

/* ── The Render Block ─────────────────────────────────────────────────── */

/**
 * Where a piece of work shows itself.
 *
 * ## The third kind of object in the thread
 *
 * A bubble means Nova is **saying** something. A Move means the founder can
 * **do** something. A render block means Vibe **made** something — an audit
 * reading, a scan, a change, a map — and this is where it appears.
 *
 * Three kinds, and none of them nests inside another. That is the same rule
 * that took the Move out of the bubble, applied one object further: a business
 * map is not a remark, so it does not get a speech bubble, and it does not
 * carry its own control either. The control that follows it sits beside it in
 * the thread, as every other control does.
 *
 * ## Why it is square where the bubble is round
 *
 * Not decoration. The bubble is round because a founder already learned that
 * shape somewhere else and what they learned is *this is speech*. A block is
 * not speech, and giving it the same silhouette would spend the one signal the
 * thread has. So it takes the system's own panel geometry — tight corners,
 * hairline, opaque — which is what every other surface holding real content in
 * this product looks like.
 *
 * ## It exists before its result does
 *
 * A block in flight is not a placeholder for a block: it is the same object,
 * showing the work instead of the outcome. That is what makes "watch it work"
 * possible without a spinner standing in for a screen nobody can see yet — and
 * it is the only place on this surface where dissolving lines belong.
 *
 * ## And it can be asked of, not only read
 *
 * The second kind is an **ask**: a block whose body is a shipped interactive
 * panel rather than a view. It exists because the alternative was worse than
 * ugly — "Answer in the Agent" sends a founder out of the conversation to
 * answer a question the conversation just asked, while the run sits paused,
 * and then expects them to come back.
 *
 * It is possible at all because the panels already separate *what is asked*
 * from *how it is answered*: `AgentQuestionPanel` takes the interrupt and a
 * control as children, `AgentWorkspaceChoice` takes candidates and a control
 * per candidate. So the panel travels into the thread and the action stays
 * with whoever can perform it.
 *
 * An ask carries a `tone`, because it is making a claim about status the way a
 * bubble does — this is your turn — and the panel it holds has given up its
 * own border to say so once instead of twice.
 */
export function RenderBlock({
  /** What kind of work this is. The product's own word, never invented here. */
  label,
  /** The register, for a block that makes a claim about status. */
  tone = "neutral",
  /** When it finished, already formatted. Absent while it is still running. */
  at,
  /**
   * The body already carries this name, so the frame does not repeat it.
   *
   * True whenever a shipped surface is composed in: the Product Scan writes
   * its own "PRODUCT SCAN · COMPLETE" eyebrow, and a frame that wrote it again
   * above put the same two words on screen twice. The label stays as the
   * region's accessible name either way — a screen reader still needs it.
   */
  namesItself = false,
  children,
  index = 0,
}: {
  label: string;
  tone?: StatusTone;
  at?: string;
  namesItself?: boolean;
  children: ReactNode;
  index?: number;
}) {
  return (
    <section
      className={`study-rise flex w-full flex-col gap-3 rounded-panel border p-4 ${BLOCK_TONE[tone]}`}
      style={{ "--i": index } as CSSProperties}
      aria-label={label}
    >
      <div className="flex items-baseline justify-between gap-3">
        {namesItself ? (
          <span aria-hidden />
        ) : (
          <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{label}</p>
        )}
        {/*
          A time only where there is one. A finished block happened at a moment
          and the row records it; a running one has not happened yet, and a
          clock beside it would be counting something nobody measured.
        */}
        {at && (
          <span className="shrink-0 font-mono text-caption text-fg-meta tabular-nums">{at}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * The lines a block writes while it runs, and then forgets.
 *
 * ## What these are, exactly
 *
 * The **stages** of the operation in flight — `OPERATION_STAGE_LABELS[stage]`,
 * the value the executor wrote to the row. The current one is bright; the ones
 * before it fade out behind it and are gone.
 *
 * That they may vanish is not a liberty taken with the record. It is what the
 * record already says: the event log stores that a run started and that it
 * finished, and the stages in between were true for a moment and were never
 * written down. A surface that kept them would be inventing a history the
 * product does not have, and one that shows them going is telling the truth
 * about what they were — snapshots.
 *
 * ## Three rules, and the first is the one that makes it usable
 *
 * - **Nothing carrying a decision or a price is ever in here.** A control that
 *   goes away under a cursor is the worst thing an interface can do, so the
 *   dissolving surface holds no controls at all — not by convention, by
 *   construction: this element renders text.
 * - **A line goes because it stopped being true, never on a timer.** A timer
 *   is a claim about how fast somebody reads. The stage changing is a fact.
 * - **Under `prefers-reduced-motion` the faded lines are not rendered.** They
 *   do not appear and then vanish without animating, which would be a flicker
 *   with no meaning; the current stage stands alone, which is the whole of the
 *   information anyway.
 */
export function Dissolving({
  /** Newest first. Only the first is current; the rest are on their way out. */
  stages,
}: {
  stages: readonly string[];
}) {
  const [current, ...fading] = stages;
  if (!current) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="study-thinking text-ui font-medium" role="status">
        {current}
      </p>
      {/*
        `aria-hidden`, and not only because they are decorative: a screen
        reader announcing three past stages every time one changes would be
        reading out a history the product deliberately does not keep.
      */}
      <div aria-hidden className="study-dissolve flex flex-col gap-1">
        {fading.slice(0, 2).map((stage, index) => (
          <p
            key={stage}
            className="text-caption text-fg-meta"
            style={{ opacity: index === 0 ? 0.55 : 0.28 }}
          >
            {stage}
          </p>
        ))}
      </div>
    </div>
  );
}

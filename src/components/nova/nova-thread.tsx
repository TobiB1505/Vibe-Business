import type { CSSProperties, ReactNode } from "react";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * The thread's furniture: what Nova says, what she made, and what happened.
 *
 * Three object kinds live on this surface and none nests inside another — a
 * bubble (`NovaBubble`, its own file), a render block, and a Move
 * (`nova-move.tsx`). Everything here is one of the first or the third's
 * supporting cast: the sentence inside a bubble, the frame around a block, the
 * status row above the thread, and the log of what already happened.
 *
 * Written in the design lab and moved here when the product began rendering
 * it. The lab draws these components rather than copies of them.
 */

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
export function NovaLine({ children }: { children: ReactNode }) {
  return <p className="text-ui text-fg">{children}</p>;
}

/** A quieter sentence. Same size as a Line — only the colour steps back. */
export function NovaAside({ children }: { children: ReactNode }) {
  return <p className="text-ui text-fg-secondary">{children}</p>;
}

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
export function NovaThreadHeader({
  availability,
  /**
   * What Nova is doing, or what is being asked of the founder.
   *
   * Replaces the availability line when present, and that is the point: "Online"
   * is a fact about a service, and nobody came to this screen to read it. What
   * belongs in the one line under her name is the *state* — the stage a run is
   * actually at, or the word for the moment that needs a person.
   *
   * Never chosen at a call site. It is `OPERATION_STAGE_LABELS` for a live run
   * and `statusForCandidate` otherwise, so this line cannot describe a moment
   * differently from the bubble below it.
   */
  status,
  /** What this conversation is about. The project's own name, never Nova's. */
  subject,
  /** Whether the repository behind that name is still reachable. */
  connected,
  /**
   * Her availability line has not arrived on the screen yet.
   *
   * Only the opening passes this, and only while the room is still being
   * assembled: the row exists a beat before her presence does. It renders her
   * name with nothing beside it — *absence*, not a word, because there is no
   * true word to write there. She is not offline, and "Connecting…" about a
   * session that is not connecting is the animated form of a lie.
   *
   * The line keeps its box either way, so nothing moves when it arrives.
   *
   * This replaced a `connecting` prop that said the same thing about the
   * *repository* — and whose only two callers were this screen, where the
   * repository answer is read on the server before the first frame. It was a
   * fabricated connection attempt every time it rendered.
   */
  availabilityPending = false,
  /** The mark, passed in so this element never decides which state it is in. */
  mark,
  /** The viewer's clock. Passed in, because only a client component has one. */
  now,
}: {
  availability: NovaAvailability;
  status?: { word: string; tone: StatusTone };
  subject: string;
  connected: boolean;
  availabilityPending?: boolean;
  mark: ReactNode;
  now?: ReactNode;
}) {
  const online = availability.state === "online";

  return (
    <header className="nova-glass sticky top-0 z-10 flex items-center gap-3.5 rounded-panel px-4 py-3">
      {mark}
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-semibold text-fg">Nova</p>
        <p
          aria-hidden={availabilityPending || undefined}
          className={`flex items-center gap-1.5 truncate text-caption text-fg-meta transition-opacity duration-200 ${
            availabilityPending ? "opacity-0" : "opacity-100"
          }`}
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              !online ? "bg-fg-disabled" : status ? STATUS_DOT[status.tone] : "bg-mint"
            }`}
          />
          {/*
            Availability outranks the state, and has to: a founder reading
            "Reading what you built" while Vibe is down would be watching a
            sentence about work that is not happening.
          */}
          {!online ? `Offline — ${availability.because}` : (status?.word ?? "Online")}
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
              connected ? "bg-mint" : "bg-coral"
            }`}
          />
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      {now}
    </header>
  );
}

/**
 * The state's own colour, on the one dot that carries it.
 *
 * Paired with the word beside it, always — `DESIGN.md` says colour is never
 * the only signal, and this dot is aria-hidden precisely because the sentence
 * next to it is the information.
 */
const STATUS_DOT: Record<StatusTone, string> = {
  neutral: "bg-fg-muted",
  active: "bg-mint",
  success: "bg-mint",
  waiting: "bg-amber",
  problem: "bg-coral",
};

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
export function NovaHappened({
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
export function NovaThinking({ children }: { children: ReactNode }) {
  return (
    <p
      className="nova-thinking nova-measure text-center text-ui font-medium"
      /* Announced as a state, not as a moving gradient. */
      role="status"
    >
      {children}
    </p>
  );
}

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
export function NovaRenderBlock({
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
      className={`nova-rise flex w-full flex-col gap-3 rounded-panel border p-4 ${BLOCK_TONE[tone]}`}
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

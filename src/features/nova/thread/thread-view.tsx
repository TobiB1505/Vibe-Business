import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaAside, NovaLine } from "@/components/nova/nova-thread";
import { EmptyState } from "@/components/ui/states";
import type { ThreadTurn, ThreadView } from "@/modules/nova/threads/view";
import { NovaComposer } from "@/features/nova/conversation/nova-composer";
import { parseArtifactRef } from "@/modules/nova/artifacts";
import { ArtifactChip, ProposalLine } from "./turn-pointers";

/**
 * A stored thread, read back.
 *
 * ## What is deliberately not here
 *
 * A composer. This slice gives a conversation a *record* — the turns a project
 * has accumulated, at an address, surviving a reload — and nothing to type
 * into. Typing arrives with the lane that can answer
 * ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §5,
 * Slice 6), because an input that took a founder's question and had nowhere to
 * send it would be worse than no input at all.
 *
 * A control, too. Every turn here is something that already happened; the
 * things to *do* are on the project index, where the ranking decides which one
 * leads. A thread that grew buttons would be a second, unranked copy of that
 * screen.
 *
 * ## Why an unread mark and not a divider
 *
 * Home deliberately has no "while you were away" line — nothing there happens
 * without the founder, so the set it would divide is either empty or the
 * present tense. A thread is the opposite: runs finish while nobody is looking,
 * and which ones are new is the question a founder opens it with. It is a mark
 * per turn rather than a rule across the thread because turns arrive in
 * batches and a single divider would have to choose one of them.
 */
export function ThreadScreen({
  view,
  /**
   * Whether this screen may ask.
   *
   * False in the lab, which mounts the transcript to look at it and has no
   * project to ask about. Every other caller leaves it alone.
   */
  composer = true,
}: {
  view: ThreadView;
  composer?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {view.turns.length === 0 ? (
        <EmptyThread />
      ) : (
        <section className="flex flex-col gap-2.5" aria-label={view.thread.title}>
          {view.turns.map((turn, index) => (
            <Turn
              key={turn.id}
              turn={turn}
              index={index}
              projectId={view.thread.projectId}
              threadId={view.thread.id}
            />
          ))}
        </section>
      )}

      {/*
        The composer, under the transcript, where a conversation puts one. It is
        the last thing on the screen because everything above it already
        happened — and it is absent in the lab, where there is no project to ask
        about (ADR 0109 §5: generation happens in a founder-initiated command,
        and a fixture has nobody to initiate it).
      */}
      {composer && view.thread.projectId.length > 0 && (
        <NovaComposer projectId={view.thread.projectId} threadId={view.thread.id} />
      )}
    </div>
  );
}

/**
 * One turn.
 *
 * ## Three shapes, and one that draws nothing
 *
 * Words are a bubble. An **artifact** is a chip that opens the pane beside this
 * conversation, and a **proposal** is a line saying she offered something —
 * neither has words of its own, and both used to fall through the null check
 * below and render nothing at all. That was a gap rather than a decision: an
 * artifact turn is a pointer, and a pointer that draws nothing is a turn the
 * founder cannot tell happened.
 *
 * What genuinely draws nothing is an **event** whose run has gone — deleted, or
 * of a type the product stopped remembering. `buildThreadView` returns null for
 * those, and a box saying "something happened" would be the surface writing a
 * fact nobody recorded.
 */
function Turn({
  turn,
  index,
  projectId,
  threadId,
}: {
  turn: ThreadTurn;
  index: number;
  projectId: string;
  threadId: string;
}) {
  if (turn.kind === "artifact") {
    const artifact = parseArtifactRef(
      turn.message.artifact?.kind,
      turn.message.artifact?.ref ?? undefined,
    );

    // A kind the union no longer holds, or a reference the address needs and
    // the row does not carry. Nothing rather than a chip that opens on nothing.
    if (artifact === null) return null;

    return (
      <NovaBubble aside tail={index === 0} index={index}>
        <ArtifactChip projectId={projectId} threadId={threadId} artifact={artifact} />
      </NovaBubble>
    );
  }

  if (turn.kind === "action_proposal" && turn.message.actionId !== null) {
    return (
      <NovaBubble aside tail={index === 0} index={index}>
        <ProposalLine projectId={projectId} actionId={turn.message.actionId} />
      </NovaBubble>
    );
  }

  if (turn.text === null) return null;

  /*
   * Three registers, from one column. Nova speaks, the founder asks, and the
   * system observes — `nova_messages.author` is what keeps them apart, and a
   * run finishing is a fact the product noticed rather than a sentence she
   * chose to say.
   *
   * The founder's own words were the one this screen did not have. Before the
   * composer they could not occur; once they could, they were drawn exactly
   * like an observation, so the only line on the screen a founder had written
   * themselves read as something Vibe had said to them.
   */
  const fromNova = turn.author === "nova";
  const mine = turn.author === "founder";

  return (
    <NovaBubble
      aside={!fromNova && !mine}
      mine={mine}
      tail={index === 0}
      index={index}
      /* A founder does not need telling that what they just asked is new. */
      eyebrow={turn.unread && !mine ? "New" : undefined}
    >
      {fromNova || mine ? <NovaLine>{turn.text}</NovaLine> : <NovaAside>{turn.text}</NovaAside>}
    </NovaBubble>
  );
}

/**
 * What a project with nothing written down yet says.
 *
 * Exported because two screens need the same sentence: this thread when it is
 * empty, and `/threads` when a project has no thread at all. Two copies of a
 * sentence is two sentences within a month.
 */
export function EmptyThread() {
  return (
    <EmptyState
      title="Nothing here yet"
      description="This is where what happens to your product gets written down. Start something from your product's home and it will show up here."
    />
  );
}

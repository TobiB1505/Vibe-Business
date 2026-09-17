import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaAside, NovaLine } from "@/components/nova/nova-thread";
import { EmptyState } from "@/components/ui/states";
import type { ThreadTurn, ThreadView } from "@/modules/nova/threads/view";

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
export function ThreadScreen({ view }: { view: ThreadView }) {
  if (view.turns.length === 0) return <EmptyThread />;

  return (
    <section className="flex flex-col gap-2.5" aria-label={view.thread.title}>
      {view.turns.map((turn, index) => (
        <Turn key={turn.id} turn={turn} index={index} />
      ))}
    </section>
  );
}

/**
 * One turn.
 *
 * A turn with no words draws nothing at all — not a frame, not a placeholder.
 * `buildThreadView` returns null for an event whose run it could not read or
 * whose type the product stopped remembering, and a box saying "something
 * happened" would be the surface writing a fact nobody recorded.
 */
function Turn({ turn, index }: { turn: ThreadTurn; index: number }) {
  if (turn.text === null) return null;

  /*
   * The register. Nova speaks; the system observes. They are different claims
   * and `nova_messages.author` is what keeps them apart — a run finishing is a
   * fact the product noticed, never a sentence she chose to say.
   */
  const fromNova = turn.author === "nova";

  return (
    <NovaBubble
      aside={!fromNova}
      tail={index === 0}
      index={index}
      eyebrow={turn.unread ? "New" : undefined}
    >
      {fromNova ? <NovaLine>{turn.text}</NovaLine> : <NovaAside>{turn.text}</NovaAside>}
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

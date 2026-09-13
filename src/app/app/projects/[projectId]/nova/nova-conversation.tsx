import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaLine } from "@/components/nova/nova-thread";
import { MoveBlock } from "@/components/nova/blocks";
import { BLOCK_FOR_ARTIFACT } from "@/modules/nova/blocks";
import type { NovaConversationArtifact, NovaConversationView } from "@/modules/nova/conversation";
import { NovaComposer } from "./nova-composer";
import { NovaTurnLive } from "./nova-turn-live";

/**
 * The conversation, under the focus.
 *
 * ## Why it sits below the ranking rather than replacing it
 *
 * A founder who opens Nova without having asked anything should still be told
 * what needs attention — that is `deriveNovaFocus`, it costs nothing, it is
 * deterministic, and it is the product's own answer to the question most
 * people arrive with. Putting a blank chat box where that used to be would
 * trade a working screen for an empty one. So the focus stays first, the
 * conversation grows beneath it, and the composer is at the bottom where a
 * founder's hands already are.
 *
 * ## Artifacts render from canonical rows
 *
 * `BLOCK_FOR_ARTIFACT` answers in a block kind and the block reads the row the
 * reference points at, resolved at render time. A Move that has since been
 * replanned therefore shows as it is now, and one that is no longer in the
 * current set shows as nothing rather than as a card built from a copy — the
 * message itself still stands, because it was true when it was written.
 *
 * ## Vibe's own words look different from Nova's
 *
 * A reply with `origin: "template"` is the fallback: the model's answer was
 * absent, cut off or refused, and what the founder is reading is the sentence
 * `fallback.ts` holds. It renders in the quiet register rather than Nova's, so
 * the difference is visible without a label claiming more than it should.
 */
export function NovaConversation({
  projectId,
  conversation,
}: {
  projectId: string;
  conversation: NovaConversationView;
}) {
  const hasMessages = conversation.messages.length > 0;

  return (
    <section className="flex w-full flex-col gap-4" aria-label="Your conversation with Nova">
      {hasMessages && (
        <ol className="flex w-full flex-col gap-4">
          {conversation.messages.map((message, index) =>
            message.role === "founder" ? (
              <li key={message.id} className="flex w-full justify-end">
                <div className="rounded-field bg-field border-line-strong text-fg-body max-w-[46ch] border px-3.5 py-2.5 text-ui">
                  {message.content}
                </div>
              </li>
            ) : (
              <li key={message.id} className="flex w-full flex-col gap-3">
                <NovaBubble index={index} aside={message.origin === "template"} tone="neutral">
                  <NovaLine>{message.content}</NovaLine>
                </NovaBubble>
                {message.artifacts.map((artifact) => (
                  <ArtifactBlock key={`${message.id}-${artifact.subjectId}`} artifact={artifact} />
                ))}
              </li>
            ),
          )}
        </ol>
      )}

      {conversation.working && (
        <NovaTurnLive projectId={projectId} working={conversation.working} />
      )}

      <NovaComposer
        projectId={projectId}
        conversationId={conversation.conversationId}
        busy={conversation.working !== null}
      />
    </section>
  );
}

function ArtifactBlock({ artifact }: { artifact: NovaConversationArtifact }) {
  const kind = BLOCK_FOR_ARTIFACT[artifact.kind];
  /*
   * `audit` maps to the audit block, which needs a reading this view does not
   * carry — the Business Health screen is where that lives. Rather than build
   * a second, thinner audit card here, an audit reference renders as nothing
   * in this slice and the reply's own sentence carries it. A kind with a
   * renderer it cannot feed is worse than a kind that waits.
   */
  if (kind !== "move" || artifact.kind !== "opportunity") return null;
  return <MoveBlock opportunity={artifact.opportunity} execution={null} />;
}

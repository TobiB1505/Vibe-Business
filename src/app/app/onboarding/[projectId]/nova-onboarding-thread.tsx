import type { ReactNode } from "react";
import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaAside, NovaLine, NovaRenderBlock } from "@/components/nova/nova-thread";
import { NOVA_ONBOARDING_DETAIL, NOVA_ONBOARDING_MESSAGE } from "@/modules/nova/onboarding";
import type { OnboardingState } from "@/modules/onboarding/state";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * Setup, as the conversation it always was.
 *
 * ## What this replaced
 *
 * Ten sections of chrome. Each state of `deriveOnboardingState` rendered an
 * eyebrow, a display heading, a paragraph of prose, and then the component that
 * actually does the work — `ProductScanExperience`, `ProductConfirmation`,
 * `LiveSiteStep`, the audit reveal, the first Move. Nova appeared beside two of
 * the ten, quoted in a box.
 *
 * The heading was the sentence she should have been saying, written as a
 * poster. So it becomes a bubble, the prose becomes her aside where it says
 * something the block does not, and the component stays exactly where it was —
 * inside a render block, which is the frame it now gets instead of a section.
 *
 * ## Why this is not `NovaFocusThread`
 *
 * They are the same shape and deliberately not the same component, because
 * they read different rankings. Home's is `deriveNovaFocus` over twenty-one
 * moments; this is `deriveOnboardingState` over eleven states, and the two answer
 * different questions — *what needs deciding* against *how far through setup
 * are we*. A component taking either would have to take a union of both, which
 * is two screens' worth of props on one object.
 *
 * What they do share is everything a founder sees: the same bubble, the same
 * register, the same render block, the same Move. That sharing is the point,
 * and it is why the sentence tables live in `modules/nova/` beside each other
 * rather than in two screens.
 *
 * ## The continuous thread
 *
 * Onboarding ends by saying what happens next — `complete` has a sentence for
 * exactly that reason — and Home's own ranking picks up the same shapes on the
 * next screen. Nothing is stored and replayed: the product keeps no transcript,
 * and a thread that pretended to would be inventing a history it does not have.
 * What makes it continuous is that both ends are Nova saying one thing at a
 * time, in the same voice, above the thing she is talking about.
 */
export function NovaOnboardingThread({
  state,
  /**
   * What Vibe made or is making, when the state has one.
   *
   * The existing component, unchanged. A state whose work is entirely Nova's
   * sentence draws no block rather than an empty frame.
   */
  block,
  /** What the block calls itself, above its own frame. */
  blockLabel,
  /**
   * True when the block writes its own heading, so the frame does not.
   *
   * The same test as Home's: whether the two say the *same* thing. The Product
   * Scan writes "Product scan · live" and would be saying it twice; a
   * confirmation form headed "Did Vibe get this right?" is a question inside a
   * block called "What I understood", which is two different things.
   */
  blockNamesItself = false,
  /** The register, from the state rather than chosen here. */
  tone = "active",
  /** What the founder can do. Outside the bubble, as every control is. */
  control,
}: {
  state: OnboardingState;
  block?: ReactNode;
  blockLabel?: string;
  blockNamesItself?: boolean;
  tone?: StatusTone;
  control?: ReactNode;
}) {
  const detail = NOVA_ONBOARDING_DETAIL[state];

  return (
    <section className="flex max-w-[44rem] flex-col gap-2.5" aria-label="Setting up">
      <NovaBubble tone={tone} index={0}>
        <NovaLine>{NOVA_ONBOARDING_MESSAGE[state]}</NovaLine>
      </NovaBubble>

      {/*
        The quieter register, for the thing that is also true. Never a caption
        on the block below — `NOVA_ONBOARDING_DETAIL` is null wherever the block
        says it better, which is seven of the eleven states.
      */}
      {detail && (
        <NovaBubble aside tail={false} index={1}>
          <NovaAside>{detail}</NovaAside>
        </NovaBubble>
      )}

      {block && (
        <NovaRenderBlock
          label={blockLabel ?? ""}
          namesItself={blockNamesItself || !blockLabel}
          tone={tone}
          index={2}
        >
          {block}
        </NovaRenderBlock>
      )}

      {control && <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">{control}</div>}
    </section>
  );
}

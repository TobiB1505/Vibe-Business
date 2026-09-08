import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaMove } from "@/components/nova/nova-move";
import { NovaLine } from "@/components/nova/nova-thread";

/**
 * The walkthrough's example: one turn of Nova, made of nothing.
 *
 * ## Why a founder is shown this rather than told it
 *
 * Because the sentence above it — *I say one thing at a time, and under it I
 * put the one thing worth doing next* — describes a shape, and a shape is the
 * one kind of thing prose is worst at. A person who has used every other
 * product on the internet arrives looking for the text box. Two seconds of
 * *this is what a message from me looks like, and this is the button under it*
 * ends that hunt in a way four more sentences would not.
 *
 * ## Why it is safe to invent the words in it
 *
 * Because nothing here is presented as a finding. Every other sentence Nova
 * has is derived from something a module established, and inventing one would
 * be the failure this product is most careful about — a plausible claim about
 * somebody's business that nothing observed.
 *
 * Three things keep this on the right side of that line, and all three are in
 * the markup rather than in a reviewer's memory:
 *
 * 1. It renders inside a block whose label says it is an example.
 * 2. The sentence introducing it — *it is only to show you how working with me
 *    feels, it is not about your product* — is the last thing said before this
 *    renders, so a reader meets the disclaimer before the example, including a
 *    reader hearing it read aloud. It lives in `first-run.ts` with the rest of
 *    her copy rather than here, because a disclaimer in JSX is a sentence no
 *    test reads.
 * 3. The Move is `NovaMove`, the span, and it is held down to an illustration:
 *    `pointer-events-none` so it never lights on hover the way a real one
 *    does, and dimmed so it does not read as the live control it sits three
 *    inches above. It was neither at first, and the render made the case —
 *    "Put the prices on the pricing page" was indistinguishable from "Right,
 *    let's set up my project", so the one sentence saying it could not be
 *    pressed was arguing with the picture next to it.
 *
 *    A disabled `NovaMoveButton` would have been the wrong fix: that is a real
 *    control turned off, which says *this exists and you may not have it*
 *    rather than *this is what one looks like*.
 *
 * ## Why the example has no price on it
 *
 * A price is a fact from `pricing.ts`, effective-dated, and the founder's
 * balance decides what is rendered beside it. Putting a plausible-looking one
 * on an invented task would be the only fabricated figure in the product. So
 * the Move carries no cost, and the sentence beside it says where a real one
 * appears — which is a claim about the interface rather than about money.
 */
export function NovaHowItWorks() {
  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="An example of one message and the control under it"
        className="flex flex-col gap-2.5"
      >
        <NovaBubble tail>
          <NovaLine>
            Your pricing page makes people start signing up before they can see what the product
            costs.
          </NovaLine>
          <NovaLine>I&apos;d make the pricing visible upfront.</NovaLine>
        </NovaBubble>

        <div className="pointer-events-none flex max-w-[24rem] flex-col gap-2.5 pt-1 opacity-60">
          <NovaMove label="Put the prices on the pricing page" />
        </div>
      </div>

      <p className="text-fg-meta text-caption">
        If an action costs Credits, the price appears right here before you start it.
      </p>
    </div>
  );
}

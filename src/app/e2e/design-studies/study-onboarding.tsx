import { ONBOARDING_STATES, type OnboardingState } from "@/modules/onboarding/state";
import { NovaOnboardingThread } from "@/app/app/onboarding/[projectId]/nova-onboarding-thread";
import { Moves } from "./elements";
import type { Study } from "./studies";

/**
 * Setup, all ten states, in the thread the product now draws (S0, onboarding).
 *
 * ## Why this exists
 *
 * The same argument as the moments gallery and the shipped opening: each of
 * these states is reachable only by a project that happens to be in it, and
 * three of them are reachable only by a project that is *stuck* in it. Read
 * one at a time over ten sessions, nobody can answer the question this page
 * exists for — *does Nova sound like one person walking somebody through
 * this?* — because the ten sentences are never on screen together.
 *
 * They were not written together either. Eight of them were headings on a
 * poster, one per section, each sized and worded for its own screen.
 *
 * ## What is real here and what is not
 *
 * The sentences and the shape are real: `NOVA_ONBOARDING_MESSAGE` and
 * `NOVA_ONBOARDING_DETAIL` are the product's own tables, read by the product's
 * own component, and nothing is written for this page.
 *
 * The blocks are not. Each one needs a live project — a scan with events, a
 * profile to confirm, an audit to reveal — so this names the component that
 * goes there instead of faking one. A fixture block would be a picture of a
 * screen rather than the screen, which is the thing this lab keeps removing.
 */

/** Which component fills the block, named rather than imitated. */
const BLOCK_FOR_STATE: Record<OnboardingState, string | null> = {
  connect_source: null,
  add_live_product: "LiveSiteStep, under the connected repository",
  product_scanning: "ProductScanExperience",
  product_reveal: "the reveal, and ProductConfirmation under it",
  audit_preparing: "StartAudit, or the live-product prerequisite",
  audit_needs_user: "NeedsUserPanel",
  audit_running: "OperationWatcher and the audit's own stage",
  audit_reveal: "OnboardingAuditReveal",
  first_move: "the Move Vibe would start with",
  complete: null,
};

/** The control each state offers, by the label the product uses. */
const CONTROL_FOR_STATE: Record<OnboardingState, string | null> = {
  connect_source: "Connect GitHub",
  add_live_product: null,
  product_scanning: null,
  product_reveal: null,
  audit_preparing: null,
  audit_needs_user: null,
  audit_running: null,
  audit_reveal: null,
  first_move: "Go to your workspace",
  complete: null,
};

export function StudyOnboarding({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div className="rounded-panel border-line-3 bg-well flex flex-col gap-3 border border-dashed p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-label text-fg-meta font-mono tracking-[0.16em] uppercase">
            Onboarding
          </p>
          <p className="text-title text-fg font-semibold">
            {ONBOARDING_STATES.length} states, one voice
          </p>
        </div>
        <p className="study-measure text-caption text-fg-prose">
          Every state <code className="font-mono">deriveOnboardingState</code> can return, through
          the product&rsquo;s own <code className="font-mono">NovaOnboardingThread</code>. The
          sentences come from the two tables in <code className="font-mono">modules/nova</code> and
          are held to the same five rules as the twenty-one moments.
        </p>
        <p className="study-measure text-caption text-fg-secondary">
          The blocks are named rather than drawn: each needs a live project, and a fixture standing
          in for one would be a picture of a screen instead of the screen. What is being judged here
          is whether the ten read as one person walking somebody through setup — they were written
          as eight separate posters, one per section.
        </p>
      </div>

      <div className={`flex flex-col divide-y divide-line-1 ${panel}`}>
        {ONBOARDING_STATES.map((state) => (
          <div key={state} className="flex flex-col gap-3 p-5">
            <p className="text-label text-fg-meta font-mono tracking-[0.16em] uppercase">{state}</p>
            <NovaOnboardingThread
              state={state}
              tone={state === "audit_needs_user" ? "waiting" : "active"}
              blockLabel={BLOCK_FOR_STATE[state] ? "In the product" : undefined}
              block={
                BLOCK_FOR_STATE[state] ? (
                  <p className="text-caption text-fg-meta font-mono">{BLOCK_FOR_STATE[state]}</p>
                ) : undefined
              }
              control={
                CONTROL_FOR_STATE[state] ? (
                  <Moves moves={[{ label: CONTROL_FOR_STATE[state] as string }]} />
                ) : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { Notice } from "@/components/ui/states";
import type { RefusalShape } from "@/modules/execution-contract/view";

/**
 * "This Move's next step isn't one Vibe can run" — said where it blocks.
 *
 * ## Why this state needed a component of its own
 *
 * The same shape `AgentStaleReadNotice` exists for, one refusal class over.
 * When the plan's current step is a founder decision, real-world work, or
 * Vibe's own work with no executor, no step resolves `agentic`, so
 * `AgentReadyStage` used to render an empty call-to-action block under a hero
 * still saying Vibe understands this code.
 *
 * ## Why one sentence was not enough
 *
 * The first version of this file said *"an earlier step comes first"* and
 * *"Vibe's part of this Move becomes available once that step is done"* about
 * every refusal it rendered. A founder then reached a step that was **Vibe's
 * own part** — a checkout build, refused because it touches payments — and
 * both sentences were false: nothing was earlier, and nothing would become
 * available. Promising an end to a refusal that has none is worse than saying
 * nothing, because the founder waits.
 *
 * So the shape of the refusal decides the words, and `REFUSAL_SHAPES` decides
 * the shape — an exhaustive record, so a new reason cannot silently inherit
 * the wrong promise.
 *
 * ## What it does not do
 *
 * Start anything, and offer no confirmation of its own. The confirmation lives
 * on the Action Plan beside the step's own completion criterion, which is the
 * sentence a founder is actually attesting to.
 *
 * The step's title is rendered as its own element rather than composed into a
 * sentence: it is model-written text, and text Vibe wrote around it must not
 * read as one continuous claim (rule 25).
 */

/** What the notice promises, if anything, about this refusal ending. */
const OUTLOOK: Record<RefusalShape, { label: string; link: string; footnote: string }> = {
  capability: {
    label: "this one is yours to close",
    link: "Confirm it on your Action Plan",
    footnote:
      "Confirming costs nothing and starts nothing. Vibe's part of this Move becomes available once it is done.",
  },
  not_vibes: {
    label: "an earlier step comes first",
    link: "Open your Action Plan",
    footnote: "Vibe's part of this Move becomes available once that step is done.",
  },
  sequencing: {
    label: "an earlier step comes first",
    link: "Open your Action Plan",
    footnote: "Vibe's part of this Move becomes available once that step is done.",
  },
  repairable: {
    label: "this Move needs something fixed first",
    link: "Open your Action Plan",
    footnote: "Once that is sorted, Vibe can pick this Move up again.",
  },
  /*
   * The one with no end, and the reason this record exists.
   *
   * No "yet", no "once", and no link that implies a way through: this step is
   * Vibe's own work and Vibe will not do it. The honest offer is a different
   * Move, so that is what the link says.
   */
  policy: {
    label: "Vibe will not do this one",
    link: "Choose a different Move",
    footnote:
      "This step is Vibe's own work, and it is the kind Vibe refuses. Nothing you change here will unlock it.",
  },
};

export function AgentPlanNextNotice({
  stepOrder,
  stepTitle,
  reasonLabel,
  planHref,
  shape,
}: {
  stepOrder: number;
  stepTitle: string;
  reasonLabel: string;
  planHref: string;
  shape: RefusalShape;
}) {
  const outlook = OUTLOOK[shape];

  return (
    <div data-testid="agent-plan-next" className="w-full max-w-[27rem]">
      <Notice
        tone={shape === "policy" ? "info" : "waiting"}
        label={outlook.label}
        action={
          <Link
            href={planHref}
            className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
            data-testid="agent-plan-next-link"
          >
            {outlook.link}
          </Link>
        }
        footnote={outlook.footnote}
      >
        <span className="text-fg-secondary font-mono text-xs">
          Step {String(stepOrder).padStart(2, "0")}
        </span>{" "}
        <span className="text-fg">{stepTitle}</span> — {reasonLabel}
      </Notice>
    </div>
  );
}

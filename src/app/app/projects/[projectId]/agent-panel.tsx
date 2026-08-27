import Link from "next/link";
import { preparedChangeHref } from "@/components/layout/project-shell";
import { STATUS_GLYPHS, StatusDot, statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { VibeCard } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { planMoveHref } from "@/modules/action-plans/source";
import type { OpportunityActionState } from "@/modules/execution/view";
import type { AgentFocus } from "@/modules/projects/agent-focus";
import type { AgentContext, AgentReadiness } from "@/modules/projects/command-center";
import { cn } from "@/lib/utils/cn";

/**
 * Vibe's engineer, as a presence rather than a status bar (CORE-5).
 *
 * ## What this screen is trying to feel like
 *
 * "My AI team member is ready", not "terminal interface". The agent is not a
 * build tool that happens to write code — it is the part of Vibe that already
 * knows the business and works on one named business problem at a time. Four
 * decisions carry that, and each is a rule the design system already holds:
 *
 * 1. **One primary object.** This is the page's only level-3 card, mint-tinted,
 *    because mint means Vibe and this card literally is Vibe. Everything below
 *    it — the prepared changes — is a level-2 panel.
 * 2. **Prose, not machine output.** The context lines are sentences a person
 *    wrote, so they are set in Space Grotesk. JetBrains Mono is reserved for
 *    what a machine produced: SHAs, branch names, counts. "Knows what your
 *    business needs next" is not machine output and must not look like it.
 * 3. **Business terms.** Not "repository snapshot: present". The rows say what
 *    the engineer knows, and each is true only because an artifact exists —
 *    `buildAgentContext` derives them, so the agent cannot claim context it
 *    does not have.
 * 4. **No fake telemetry.** No progress bar, no percentage, no spinner
 *    implying a measured remaining time. State is named in words.
 *
 * ## What it must not say
 *
 * That the agent is working, will work, or can be told to work from here.
 * Preparing a change is a priced, confirmed action that lives on the Action
 * Plan beside the Move it belongs to. This card describes readiness and points
 * at where work is chosen; it starts nothing.
 *
 * ## The Move a founder arrived with (UI-S3 §3)
 *
 * Everything above is project-level and stays that way. What was missing is
 * the sentence a founder came for: they picked a Move on the Action Plan, they
 * opened the Agent, and the Agent had never heard of it.
 *
 * The block below names that Move and says what Vibe can do about it — using
 * the state the Action Plan is already rendering, so the two screens cannot
 * describe the same Move differently. It ends in a link back, and that link is
 * the only thing it offers: the rule above is not relaxed by a focus, and this
 * block carries no form, no price and no control that spends anything.
 */

const READINESS_TONE: Record<AgentReadiness, StatusTone> = {
  ready: "active",
  // Amber: something is genuinely incomplete and a person can complete it.
  partial: "waiting",
  // Neutral, deliberately not coral. Nothing has failed — Vibe simply has not
  // been given anything to work from yet.
  not_briefed: "neutral",
};

const READINESS_HEADLINE: Record<AgentReadiness, string> = {
  ready: "Ready",
  partial: "Getting up to speed",
  not_briefed: "Not briefed yet",
};

const READINESS_DETAIL: Record<AgentReadiness, string> = {
  ready:
    "Your engineer has everything it needs to work on a change: what your product is, the code behind it, and what the business needs next.",
  partial:
    "Your engineer can work, but it is missing part of the picture. The unfinished lines below are what it would be guessing at.",
  not_briefed:
    "Your engineer has nothing to work from yet. It reads your product and your business before it writes anything, and none of that has happened.",
};

/**
 * What Vibe can do about the Move in focus, in a founder's words.
 *
 * Keyed on `OpportunityActionState["kind"]` so a new execution state is a
 * compile error here rather than a silently missing sentence. Each is a
 * statement about Vibe's own position, and none of them is an invitation to
 * act from this card.
 */
const FOCUS_DETAIL: Record<OpportunityActionState["kind"], string> = {
  preparable:
    "Vibe can write this change. Starting it happens on the Action Plan, where you see what it costs before anything runs.",
  already_prepared: "Vibe has written a change for this move. It is waiting below for your review.",
  /*
   * Deliberately not "Vibe is writing this now". This surface narrates no work
   * in flight — `command-center-ui.test.ts` enforces that, and the reason
   * holds here too: this card does not poll, so a present-tense sentence would
   * keep claiming activity long after the run ended. The Action Plan follows
   * the run, and this points at it.
   */
  preparing: "A change for this move has been started. Your Action Plan follows it while it runs.",
  failed: "Vibe's last attempt at this move did not finish. The Action Plan says what happened.",
  blocked: "Something has to change before Vibe can act on this move. The Action Plan says what.",
  needs_user_input: "This move needs a decision from you before any code can be written for it.",
  not_automated: "This is not a change Vibe can make for you. It is yours to do.",
};

function FocusBlock({
  focus,
  planHref,
  agentHref,
}: {
  focus: AgentFocus;
  planHref: string;
  agentHref: string;
}) {
  // Nothing was asked for, or what was asked for is not this project's work.
  // Both render nothing: a superseded Move is not an error, and substituting a
  // different one would put a claim on screen nobody made.
  if (focus.kind === "none" || focus.kind === "unresolved") return null;

  const detail =
    focus.kind === "unavailable"
      ? // A statement about Vibe's context, never about the Move. The unfinished
        // rows below this block are what explain it.
        "Vibe has not read your code yet, so it cannot say what it would do about this move."
      : FOCUS_DETAIL[focus.action.kind];

  const preparedChangeId =
    focus.kind === "focused" && focus.action.kind === "already_prepared"
      ? focus.action.preparedChangeId
      : null;

  return (
    <div className="border-line-2 flex flex-col gap-2 border-t pt-5" data-testid="agent-focus">
      <MonoLabel>Working on</MonoLabel>
      <p className="text-fg text-base leading-snug font-semibold">
        {/* The engine's persisted rank, not a position in a list. */}
        <span className="text-fg-meta font-mono text-meta">
          {String(focus.move.rank).padStart(2, "0")}
        </span>{" "}
        {focus.move.title}
      </p>
      <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">{detail}</p>
      <p className="text-fg-muted text-sm">
        {preparedChangeId ? (
          <Link
            href={preparedChangeHref(agentHref, preparedChangeId)}
            className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
          >
            Review the prepared change
          </Link>
        ) : (
          <Link
            href={planMoveHref(planHref, focus.move.id)}
            className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
          >
            Open this move in your Action Plan
          </Link>
        )}
      </p>
    </div>
  );
}

export function AgentPanel({
  context,
  /** The Move this visit is about, when the URL named one Vibe could resolve. */
  focus = { kind: "none" },
  preparedCount,
  planHref,
  /** This page's own URL, so a prepared change can be addressed by its anchor. */
  agentHref = "",
  productHref,
  /** The internal execution surface, when this project is allowed to reach it. */
  executionHref,
}: {
  context: AgentContext;
  focus?: AgentFocus;
  preparedCount: number;
  planHref: string;
  agentHref?: string;
  productHref: string;
  executionHref: string | null;
}) {
  const tone = READINESS_TONE[context.readiness];

  return (
    <VibeCard
      padding="lg"
      tone={context.readiness === "ready" ? "mint" : "neutral"}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <MonoLabel>Your engineer</MonoLabel>
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot tone={tone} />
          <h3 className="text-fg text-title font-bold">{READINESS_HEADLINE[context.readiness]}</h3>
        </div>
        <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">
          {READINESS_DETAIL[context.readiness]}
        </p>
      </div>

      <FocusBlock focus={focus} planHref={planHref} agentHref={agentHref} />

      <ul className="flex flex-col gap-3">
        {context.rows.map((row) => (
          <li key={row.id} className="flex gap-2.5">
            {/*
              Decorative. The label and the sentence beneath it carry the same
              state, so nothing depends on the mark or its colour being seen.
            */}
            <span
              aria-hidden
              className={cn("mt-px shrink-0 text-sm", row.ready ? statusToneText("success") : "text-fg-faint")}
            >
              {row.ready ? STATUS_GLYPHS.confirmed : STATUS_GLYPHS.pending}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  "text-sm font-medium",
                  row.ready ? "text-fg-body" : "text-fg-muted",
                )}
              >
                {row.label}
              </span>
              <span className="text-fg-muted text-ui leading-relaxed">{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="border-line-2 flex flex-col gap-2 border-t pt-5">
        <p className="text-fg-prose text-sm leading-relaxed">
          {preparedCount > 0
            ? `${preparedCount} ${preparedCount === 1 ? "change is" : "changes are"} below, each with what Vibe checked and what still needs you.`
            : "Nothing is in progress. Work is chosen from your Action Plan, one move at a time."}
        </p>
        {/*
          Where the work is actually chosen. Not a control that starts one —
          preparing a change is priced and confirmed, and it happens beside the
          Move it belongs to.
        */}
        <p className="text-fg-muted text-sm">
          {context.rows.every((row) => row.ready) ? (
            <>
              Pick what it works on from your{" "}
              <Link
                href={planHref}
                className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
              >
                Action Plan
              </Link>
              .
            </>
          ) : (
            <>
              Fill in what it&apos;s missing on{" "}
              <Link
                href={productHref}
                className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
              >
                My Product
              </Link>
              .
            </>
          )}
          {executionHref && (
            <>
              {" "}
              <Link
                href={executionHref}
                className="text-fg-muted hover:text-fg-body rounded-sm underline underline-offset-4 transition-interactive"
              >
                Run a step directly
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </VibeCard>
  );
}

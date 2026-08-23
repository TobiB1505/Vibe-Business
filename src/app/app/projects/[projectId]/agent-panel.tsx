import Link from "next/link";
import { STATUS_GLYPHS, StatusDot, statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { VibeCard } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
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

export function AgentPanel({
  context,
  preparedCount,
  planHref,
  productHref,
  /** The internal execution surface, when this project is allowed to reach it. */
  executionHref,
}: {
  context: AgentContext;
  preparedCount: number;
  planHref: string;
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

import { AgentRunFiles } from "@/app/app/projects/[projectId]/agent/agent-run-files";
import { ValidationDepthNote } from "@/app/app/projects/[projectId]/agent/validation-depth-note";
import { CostLine } from "@/components/system/cost-line";
import { FindingCard } from "@/components/system/finding-card";
import { SourceCoverageList, SourceCoverageStrip } from "@/components/system/source-coverage";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { creditsToUnits } from "@/modules/credits/units";
import type { SourceCoverage } from "@/modules/provenance/source-coverage";
import type { LiveFile } from "@/modules/coding-agent/observability/live-view";
import { LandingFlowTabs, type FlowTab } from "./landing-flow-tabs";

/**
 * The six steps, each shown through the component the product actually uses.
 *
 * ## The one thing a template cannot copy
 *
 * Every landing template in the catalogue fills this slot with a rendered
 * mockup, and the good ones look better than a real screen because a mockup
 * may show whatever number flatters it. This product cannot do that — the
 * truthfulness rules apply to a marketing page exactly as they do to a
 * dashboard (DESIGN.md) — so the advantage has to come from the opposite
 * direction: these are the real components, and they are honest here because
 * they are honest everywhere.
 *
 * The data is example data and the section says so. What is *not* example is
 * the behaviour: a partial source states why it stopped short, a skipped
 * validation step says it was skipped, a refused path is named, and the price
 * beside a remedy is resolved from the rate card in force rather than typed
 * into this file.
 */

/** Shared with the trust bento, which shows the same four at strip density. */
export const EXAMPLE_SOURCES: SourceCoverage[] = [
  {
    source: "repository",
    label: "Your code",
    state: "ready",
    detail: "Vibe has read what your repository builds.",
    reasons: [],
    measured: { files: 128 },
    at: "2026-08-14T08:22:59.917Z",
    remedy: { label: "Scan again", href: "#top", operation: "product_understanding" },
  },
  {
    source: "live",
    label: "Your public product",
    state: "partial",
    detail: "Vibe visited your product, but couldn't read all of it.",
    reasons: [
      "Two pages on your site build themselves in your visitor's browser, so Vibe saw an empty shell for those.",
    ],
    measured: { pages: 6 },
    at: "2026-08-14T08:24:11.000Z",
    remedy: { label: "Scan again", href: "#top", operation: "product_understanding" },
  },
  {
    source: "deep_scan",
    label: "Your signed-in product",
    state: "none",
    detail: "Vibe hasn't seen past your sign-in yet.",
    reasons: [],
    measured: {},
    at: null,
    remedy: { label: "Deep Scan", href: "#pricing", operation: "deep_scan" },
  },
  {
    source: "founder",
    label: "What you told Vibe",
    state: "ready",
    detail: "Your own words about the business, which outrank anything derived.",
    reasons: [],
    measured: {},
    at: null,
    remedy: null,
  },
];

const RUN_FILES: LiveFile[] = [
  {
    path: "src/app/pricing/page.tsx",
    kind: "generated",
    detail: null,
    bytes: 1840,
    withheldBy: null,
  },
  {
    path: "src/components/pricing-table.tsx",
    kind: "generated",
    detail: null,
    bytes: 920,
    withheldBy: null,
  },
  { path: "package.json", kind: "observed", detail: null, bytes: null, withheldBy: null },
  {
    path: ".env.local",
    kind: "candidate",
    detail: null,
    bytes: null,
    withheldBy: "Sensitive path policy",
  },
];

const PLAN_STEPS = [
  { title: "Add a pricing section people can reach", actor: "Vibe can do this", tone: "active" },
  { title: "Decide what the three tiers cost", actor: "Needs your input", tone: "waiting" },
  { title: "Link it from the navigation", actor: "Vibe can do this", tone: "active" },
] as const;

const TABS: FlowTab[] = [
  {
    id: "understand",
    label: "Understand",
    headline: "Vibe reads your code and your live product, and says how far it got.",
    /*
      The strip says what the whole reading rests on; one card shows what a
      source looks like when it could not finish. Four full cards was the
      other option and it made this panel half again as tall as every other
      one — which is a page that jumps 337px under a reader on a tab click.
    */
    panel: (
      <div className="flex flex-col gap-5">
        <div className="border-line-1 bg-surface-3 rounded-well border p-4">
          <SourceCoverageStrip sources={EXAMPLE_SOURCES} />
        </div>
        <SourceCoverageList sources={EXAMPLE_SOURCES.slice(1, 3)} />
      </div>
    ),
  },
  {
    id: "diagnose",
    label: "Diagnose",
    headline: "Nine business areas, judged together on evidence you can open.",
    panel: (
      <FindingCard
        title="People still don't have a clear way to pay you."
        explanation="Your product is live and people can sign up, but nothing on it says what anything costs or how to buy."
        whyItMatters="Someone can like what you built and still leave, because they never find out what it costs."
        severity="critical"
        confidence={{ kind: "coverage", scored: 7, eligible: 9 }}
        citations={[
          { detail: "No pricing page was found on your live product.", source: "Your live site" },
          { detail: "A payments dependency is declared in your code.", source: "Your code" },
        ]}
      />
    ),
  },
  {
    id: "prioritize",
    label: "Prioritize",
    headline: "One move leads, and it leads with what it costs you to leave it alone.",
    panel: (
      <FindingCard
        variant="priority"
        rank={1}
        lead="why"
        title="Decide how customers pay"
        explanation="Vibe found a payments library in your code and no reachable checkout on your site."
        whyItMatters="Every visitor who wanted to buy today could not, and nothing on the page told them why."
        severity="critical"
        confidence={{ kind: "judgment", level: "high" }}
        citations={[
          { detail: "Checkout was not reachable from any page Vibe visited.", source: "Your live site" },
        ]}
      />
    ),
  },
  {
    id: "plan",
    label: "Plan",
    headline: "The move becomes steps, and each one says who does it.",
    panel: (
      <ul className="flex flex-col gap-2">
        {PLAN_STEPS.map((step, index) => (
          <li
            key={step.title}
            className="border-line-1 bg-surface-3 rounded-well flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border p-4"
          >
            <span className="flex min-w-0 items-baseline gap-3">
              <span className="text-fg-meta shrink-0 font-mono text-meta tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-fg-body text-sm">{step.title}</span>
            </span>
            {/* Ownership, never a percentage or a due date — the product has neither. */}
            <StatusPill tone={step.tone === "waiting" ? "waiting" : "active"}>
              {step.actor}
            </StatusPill>
          </li>
        ))}
      </ul>
    ),
  },
  {
    id: "execute",
    label: "Execute",
    headline: "Vibe works on its own branch, and shows you everything it touched.",
    panel: (
      <div className="flex flex-col gap-5">
        <AgentRunFiles files={RUN_FILES} />
        <ValidationDepthNote
          depth={{
            depth: "fast",
            label: "Fast",
            reason: "a low-risk presentational change",
            notRun: ["test", "build"],
          }}
        />
        <CostLine cost={{ kind: "settled", credits: creditsToUnits(200) }} />
      </div>
    ),
  },
  {
    id: "measure",
    label: "Measure",
    headline: "After it ships, Vibe checks what became visible — and admits what it cannot see.",
    panel: (
      <div className="flex flex-col gap-4">
        <div className="border-line-1 bg-surface-3 rounded-well flex flex-col gap-3 border p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone="success">Observed</StatusPill>
            <span className="text-fg-body text-sm">
              A pricing page is now reachable from your homepage.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone="neutral">Not measured</StatusPill>
            <span className="text-fg-body text-sm">
              Whether more people paid. Vibe reads your public product, not your revenue.
            </span>
          </div>
        </div>
        <p className="text-fg-muted max-w-[62ch] text-ui leading-relaxed">
          Vibe proves a change is reachable, never that it worked. The second line is the one most
          products would quietly leave out.
        </p>
      </div>
    ),
  },
];

export function LandingFlow() {
  return (
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-24 py-20 sm:py-28">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col items-start gap-5">
          <MonoLabel className="text-mint">How Vibe turns code into progress</MonoLabel>
          <h2
            id="how-heading"
            className="text-fg max-w-[20ch] text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
          >
            From code to business. <span className="text-mint">Vibe</span> every step.
          </h2>
          <p className="text-fg-prose max-w-[62ch] leading-relaxed">
            One continuous path from product understanding to a reviewed, measurable change. Every
            panel below is the real screen from the product, on example data.
          </p>
        </div>

        <LandingFlowTabs tabs={TABS} />
      </div>
    </section>
  );
}

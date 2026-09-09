import { FindingCard } from "@/components/system/finding-card";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { LandingFlowTabs, type FlowTab } from "./landing-flow-tabs";

/**
 * What is left of the tab bar, each tab shown through the component the
 * product actually uses.
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
 * the behaviour: a partial source states why it stopped short, a step nobody
 * can do for you says so instead of showing a percentage, and the closing
 * panel names the thing Vibe cannot measure.
 *
 * ## Three tabs, and shrinking
 *
 * UI-34 is taking this bar apart one step at a time, because a tab bar asks a
 * reader to stop and choose inside a page whose whole shape is a scroll.
 * *Understand* left first and is `LandingScan`; *Prioritize* left next and is
 * `LandingMove`; *Execute* left with its file list, its validation depth and
 * its cost line, and is `LandingAgent`. What remains is what has not been given
 * a block of its own yet.
 */

const PLAN_STEPS = [
  { title: "Add a pricing section people can reach", actor: "Vibe can do this", tone: "active" },
  { title: "Decide what the three tiers cost", actor: "Needs your input", tone: "waiting" },
  { title: "Link it from the navigation", actor: "Vibe can do this", tone: "active" },
] as const;

const TABS: FlowTab[] = [
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
              <span className="text-fg-body text-body">{step.title}</span>
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
    id: "measure",
    label: "Measure",
    headline: "After it ships, Vibe checks what became visible — and admits what it cannot see.",
    panel: (
      <div className="flex flex-col gap-4">
        <div className="border-line-1 bg-surface-3 rounded-well flex flex-col gap-3 border p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone="success">Observed</StatusPill>
            <span className="text-fg-body text-body">
              A pricing page is now reachable from your homepage.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone="neutral">Not measured</StatusPill>
            <span className="text-fg-body text-body">
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
          {/*
            "from what it read" rather than "from product understanding": the
            step that reads is a block of its own now (`LandingScan`), so this
            section starts where that one ends and must not claim to contain it.
          */}
          <p className="text-fg-prose max-w-[62ch] leading-relaxed">
            One continuous path from what Vibe read to a reviewed, measurable change. Every panel
            below is the real screen from the product, on example data.
          </p>
        </div>

        <LandingFlowTabs tabs={TABS} />
      </div>
    </section>
  );
}

"use client";

import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { AgentRunFiles } from "@/app/app/projects/[projectId]/agent/agent-run-files";
import { ValidationDepthNote } from "@/app/app/projects/[projectId]/agent/validation-depth-note";
import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { CostLine } from "@/components/system/cost-line";
import { LockIcon } from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import type { LiveFile } from "@/modules/coding-agent/observability/live-view";
import { creditsToUnits } from "@/modules/credits/units";

/**
 * The Agent: a flow with gates (UI-34).
 *
 * ## The shape is the argument, again
 *
 * Step one is two tiles — a thing and an explanation. Step two is a staircase.
 * Step three is a narrowing. This one is a **passage**: a path down the page
 * with a barrier across it at four points, and each barrier parts as it is
 * reached — except the last, which does not part at all.
 *
 * That is the entire claim of this module drawn rather than asserted. An agent
 * that writes code is not the interesting part and every competitor has one;
 * what a founder is actually deciding is whether to let a machine near the
 * branch they ship from. The answer is four checks Vibe makes on itself and one
 * it cannot make: the last gate has no mechanism on the inside.
 *
 * ## Why the last gate is drawn shut
 *
 * Because it is shut. Rule 58 gives Vibe exactly one path to a default branch
 * and it is not autonomous: a human approval binds to one immutable commit
 * (rule 67), the write is authorized by that approval *and* by live state read
 * immediately before it (rule 70), and the move is a fast-forward to that exact
 * commit or a refusal (rule 71). A gate animation that opened on scroll like
 * the other four would be the page contradicting the architecture.
 *
 * ## What each gate says when it does not open
 *
 * Every gate carries its failure, because a gate that only ever passes is
 * decoration. A moved branch blocks rather than triggering merge reasoning
 * (rule 56). A workspace reading Vibe cannot complete fails the run instead of
 * becoming a partial change (rule 77). And a validation that passes authorizes
 * nothing (rule 66) — which is written here in the words the rule uses, on the
 * page most tempted to round it up to "safe".
 *
 * ## Where the panels came from
 *
 * `LandingFlow`'s *Execute* tab, moved rather than copied — the third step to
 * leave the tab bar after *Understand* and *Prioritize*. `AgentRunFiles` is
 * the product's own file list, and the withheld `.env.local` row is the reason
 * it is here: a refused path is a fact about the run that no diff can show.
 */

/**
 * One run's files, as the product's live view models them.
 *
 * The withheld row is the point. `generated` and `observed` are what any tool
 * would list; a path the agent offered and policy refused is the one a founder
 * cannot discover any other way.
 */
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

type Stage = {
  name: string;
  what: string;
  panel?: ReactNode;
  gate: { condition: string; otherwise: string };
};

const STAGES: Stage[] = [
  {
    name: "Understand",
    what: "Vibe reads your repository again at the exact commit the analysis was made on — not at whatever the branch has become since.",
    gate: {
      condition: "The repository is still where the analysis left it.",
      otherwise:
        "A branch that moved stops the run before anything is prepared. Vibe does not reason about the difference, and it does not merge to close it.",
    },
  },
  {
    name: "Build",
    what: "A sandbox clones that commit and the agent works inside it. The machine holds no credential of yours and no lasting key of ours: it cannot reach your account, your database or anything you deploy.",
    panel: <AgentRunFiles files={RUN_FILES} title="What the run touched" />,
    gate: {
      condition: "Every file in the change is one Vibe read back out of the workspace itself.",
      otherwise:
        "Vibe never takes the agent's account of its own work. A reading it cannot complete fails the run instead of becoming a partial change.",
    },
  },
  {
    name: "Validate",
    what: "Your project's own checks run in a second isolated machine, with the network switched off before the first command out of your repository is allowed to run.",
    panel: (
      <ValidationDepthNote
        depth={{
          depth: "fast",
          label: "Fast",
          reason: "a low-risk presentational change",
          notRun: ["test", "build"],
        }}
      />
    ),
    gate: {
      condition: "The commands your project defines exit zero.",
      otherwise:
        "The change stays on its branch and Vibe names the check that stopped it. A pass means those commands exited zero — never that the change is safe, correct or ready, and Vibe will not word it as though it were.",
    },
  },
  {
    name: "Preview",
    what: "The branch served on an address of its own, so you can open the change rather than read a description of it. A change that touches no page has nothing to serve, and Vibe says so instead of offering you a preview of a page that did not move.",
    gate: {
      condition: "You approve one exact commit.",
      otherwise:
        "This one has no mechanism on the inside. Vibe approves nothing on your behalf, and your approval binds to that commit — not to the branch, and not to whatever the branch becomes afterwards.",
    },
  },
];

/**
 * The barrier across the path, and the two lines that say what it is for.
 *
 * The drawing is `aria-hidden` and the sentences are not: a screen reader gets
 * "Gate — the repository is still where the analysis left it", which is the
 * whole content. Two hairline leaves retract into the walls as the gate is
 * reached, which is why the row clips: a gate opens by going somewhere, and
 * leaves that slid out over the page would read as lines falling off it.
 *
 * The path below a shut gate is missing rather than dimmed, because that is
 * what a run stopped at a gate looks like from underneath.
 */
function Gate({
  condition,
  otherwise,
  closed = false,
  delay = 0,
}: {
  condition: string;
  otherwise: string;
  closed?: boolean;
  delay?: number;
}) {
  const reduced = useReducedMotion();

  /*
   * A leaf retracts by 44% of its own width, so half of it stays against the
   * wall it came out of. Fully off-screen would read as two lines that
   * vanished rather than as a gate standing open, and at 62% — measured at
   * 1440 — what was left read as two dashes at the margins rather than as
   * doors.
   */
  const parted = (direction: -1 | 1) => (closed ? "0%" : `${direction * 44}%`);

  /*
   * A gate that only opens when it is scrolled to is a gate a reduced-motion
   * reader never sees open — and shut means something specific in this block.
   * So the movement is the scroll's, and the *position* is not: asked for no
   * motion, the leaves are simply already where they end up.
   *
   * `useReducedMotion` answers `null` on the server, so the rule in
   * `globals.css` covers the window before hydration, and the `<noscript>` in
   * `page.tsx` covers a reader who never gets any.
   */
  const travel = (direction: -1 | 1) =>
    reduced
      ? { initial: false as const, animate: { x: parted(direction) } }
      : {
          initial: { x: 0 },
          whileInView: { x: parted(direction) },
          viewport: { once: true, margin: "0px 0px -14% 0px" },
        };

  return (
    <div className="flex flex-col items-center gap-4">
      <div aria-hidden className="relative h-24 w-full overflow-hidden">
        {/* The path. It ends at a shut gate rather than continuing past it. */}
        <span
          className={cn(
            "bg-line-strong absolute left-1/2 w-px",
            closed ? "top-0 h-1/2" : "inset-y-0",
          )}
        />

        {[-1 as const, 1 as const].map((direction) => (
          <motion.span
            key={direction}
            data-gate-leaf
            style={{ "--gate-part": parted(direction) } as CSSProperties}
            {...travel(direction)}
            transition={{ duration: 0.72, ease: [0.22, 0.61, 0.36, 1], delay }}
            className={cn(
              "absolute top-1/2 h-0.5 w-1/2 rounded-full",
              direction === -1
                ? "from-line-strong left-0 bg-gradient-to-r"
                : "from-line-strong right-0 bg-gradient-to-l",
              closed ? "to-fg-muted" : "to-mint/70",
            )}
          />
        ))}

        {closed && (
          <span className="border-line-3 bg-app text-fg-secondary absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border">
            <LockIcon size={16} />
          </span>
        )}
      </div>

      <div className="flex max-w-[52ch] flex-col items-center gap-1.5 text-center">
        <p className="text-fg text-body font-semibold text-balance">
          <MonoLabel as="span" className={cn("mr-2.5", closed ? "text-fg-meta" : "text-mint")}>
            {closed ? "Your gate" : "Gate"}
          </MonoLabel>
          {condition}
        </p>
        <p className="text-fg-muted text-caption leading-relaxed">{otherwise}</p>
      </div>
    </div>
  );
}

export function LandingAgent() {
  return (
    <LandingStep index="04" id="agent" labelledBy="agent-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">The Agent</MonoLabel>
          <h2
            id="agent-heading"
            className="text-fg max-w-[22ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            Four gates. The last one is you.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            When you start a Move, Vibe prepares the change itself — in a machine of its own, on a
            branch of its own. Three gates open on evidence Vibe gathered about its own work. The
            fourth has nothing on the inside to open it. Every panel below is a screen from the
            product, on example data.
          </p>
        </div>
      </Reveal>

      {/*
        The passage. An `ol` because the order is the run's own — a validation
        cannot precede the build it validates — and each gate belongs to the
        stage above it rather than floating between two.
      */}
      <ol className="mx-auto mt-16 flex w-full max-w-2xl flex-col sm:mt-20">
        {STAGES.map((stage, index) => (
          <li key={stage.name} className="flex flex-col">
            <Reveal from="up">
              <div className="border-line-2 bg-surface-2 rounded-card flex flex-col gap-3 border px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <MonoLabel as="span" className="text-fg-meta">
                    Stage {index + 1}
                  </MonoLabel>
                  <span className="text-fg text-title font-semibold">{stage.name}</span>
                </div>
                <p className="text-fg-prose leading-relaxed">{stage.what}</p>
                {stage.panel && <div className="mt-1">{stage.panel}</div>}
              </div>
            </Reveal>

            <Reveal from="up" delay={0.06}>
              <Gate
                condition={stage.gate.condition}
                otherwise={stage.gate.otherwise}
                closed={index === STAGES.length - 1}
                delay={0.1}
              />
            </Reveal>
          </li>
        ))}
      </ol>

      {/*
        What happens on the other side of a gate only a person opens — and the
        sentence most products leave out. Moving a default branch is not a
        deployment and can still cause one, and both halves have to be said
        before the click rather than after it (rule 74).
      */}
      <Reveal from="up" className="mt-12">
        <div className="border-line-2 bg-surface-1 rounded-card mx-auto flex w-full max-w-2xl flex-col gap-3 border p-6">
          <MonoLabel className="text-fg-meta">After you open it</MonoLabel>
          <p className="text-fg-body leading-relaxed">
            Vibe reads GitHub again, right then, and fast-forwards your default branch to exactly
            the commit you approved — or refuses. It never merges, rebases, forces or deletes
            anything to get there.
          </p>
          <p className="text-fg-muted text-caption leading-relaxed">
            Merged means one thing: your default branch points at that commit, and Vibe read it back
            to check. It does not mean deployed — Vibe calls no deployment provider at all. Moving a
            default branch can still start your own pipeline, which is why Vibe tells you that
            before the button and not after it.
          </p>
          <CostLine cost={{ kind: "settled", credits: creditsToUnits(200) }} className="mt-1" />
        </div>
      </Reveal>
    </LandingStep>
  );
}

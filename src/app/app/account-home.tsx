import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { PlusIcon } from "@/components/ui/dashboard-icons";
import { Reveal } from "@/components/ui/motion";
import { productDisplayName } from "@/modules/projects/display-name";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { buildDesk } from "./desk";
import { DeskHead } from "./desk-head";
import { DeskRow } from "./desk-row";

/**
 * The account dashboard: one ranked list, most urgent first.
 *
 * ## What this replaced, and why
 *
 * A signal card, a grid of product cards and a connect band — a screen
 * organised by *object*. A founder arriving asks one question, *what do I do?*,
 * and the product already answers it: `buildAttentionItems` ranks every waiting
 * decision by tier, and the old screen used that ranking only to pick a hero
 * and to sort a grid. Everything else it knew — that a validation had **failed**
 * rather than merely waited, that one product raised two decisions — reached
 * the founder nowhere.
 *
 * So the screen is the ranking. `desk.ts` builds it; the first entry opens into
 * the decision itself and the rest are rows. See that file for the argument in
 * full, and `desk-row.tsx` for why rows rather than cards.
 *
 * ## What survives from the old screen, deliberately
 *
 * One primary object — the head is the only `card`, everything under it is a
 * `panel`. The ranking. The refusal to invent an account-wide average, a usage
 * strip or an activity feed. And the honest empty state, which is the product's
 * first real sentence to a new user and says what Vibe does rather than that a
 * list is empty.
 *
 * ## Why the composition is a component and not the page
 *
 * The browser harness renders components rather than pages — it has no
 * database — so a test that re-assembled these pieces itself would be measuring
 * a screen that exists only in the test file. The page keeps what a page owns:
 * the session, the reads, the redirects.
 */

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "GitHub authorization was cancelled or denied.",
  state_invalid:
    "That connection attempt expired or was invalid. Please try connecting GitHub again.",
  missing_params:
    "GitHub didn't return the information needed to complete the connection. Please try again.",
  installation_not_accessible:
    "That GitHub installation isn't accessible to your GitHub account. Please try again.",
  github_unavailable: "GitHub is temporarily unavailable. Please try again in a moment.",
};

/**
 * The empty dashboard is the product's first real sentence to a new user, so
 * it says what Vibe does rather than that a list is empty. It links the
 * existing connect flow and introduces nothing new.
 */
function EmptyDashboard() {
  return (
    <Reveal>
      <Surface level="card" padding="lg" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <MonoLabel>Get started</MonoLabel>
          <h2 className="text-fg text-headline max-w-[24ch] font-bold text-balance">
            Turn what you built into a business.
          </h2>
          <p className="text-fg-prose max-w-[60ch] text-body leading-relaxed">
            Connect a repository you have already built. Vibe reads the product, scores the business
            around it, and shows you what to do next. Anything it prepares later lands on its own
            branch — the branch you ship from moves only when you approve a change.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/app/connect/github" className={buttonClasses()}>
            Connect GitHub
          </Link>
          <span className="text-fg-meta text-caption">Opens GitHub · takes about a minute</span>
        </div>
      </Surface>
    </Reveal>
  );
}

/**
 * The way to add another product: a route, not an offer.
 *
 * Last on the desk because it is the only entry that is not about a product the
 * founder already has, and it is the quietest surface on the screen because a
 * utility link must not carry the weight of the decisions above it.
 */
function ConnectRow({ index }: { index: number }) {
  return (
    <Reveal as="li" index={index}>
      <Link
        href="/app/connect/github"
        className="group border-line-1 rounded-panel text-fg-secondary hover:border-line-3 hover:text-fg flex items-center gap-4 border border-dashed px-4 py-3.5 transition-interactive focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none sm:px-5"
      >
        <span
          aria-hidden
          className="bg-mint-tint text-mint flex size-8 shrink-0 items-center justify-center rounded-nav"
        >
          <PlusIcon size={16} />
        </span>
        <span className="text-ui font-semibold">Connect another product</span>
      </Link>
    </Reveal>
  );
}

export function AccountHome({
  projects,
  connectError = null,
  unfinishedSetupProjectId = null,
}: {
  projects: DashboardProject[];
  connectError?: string | null;
  /** A project whose setup was never finished. Offered, never redirected to. */
  unfinishedSetupProjectId?: string | null;
}) {
  const projectNames = new Map(
    projects.map((project) => [project.id, productDisplayName(project)]),
  );

  const desk = buildDesk(projects);
  const [head, ...rest] = desk;

  const waiting = desk.filter((entry) => entry.kind === "item").length;

  /*
   * The headline states a fact or says there is nothing. No greeting by name
   * and no time of day: the session carries an email, not a name, and the
   * server's clock is not the user's. Inventing either would be exactly the
   * fake personalisation this product avoids.
   */
  const headline = projects.length === 0 ? "Welcome to Vibe Business." : "Welcome back.";
  const summary =
    waiting === 0
      ? "Nothing is waiting on you. Every product is up to date."
      : `${waiting} ${waiting === 1 ? "decision is" : "decisions are"} waiting, most urgent first.`;

  return (
    <div className="flex flex-col gap-6" data-testid="account-home">
      {connectError && (
        <Notice tone="problem" label="Connection failed">
          {CONNECT_ERROR_MESSAGES[connectError] ?? "GitHub connection failed. Please try again."}
        </Notice>
      )}

      {unfinishedSetupProjectId && (
        <Notice
          label="Setup not finished"
          action={
            <Link
              href={`/app/onboarding/${unfinishedSetupProjectId}`}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Continue setup
            </Link>
          }
        >
          {projectNames.get(unfinishedSetupProjectId) ?? "One of your projects"} hasn&rsquo;t
          finished setup. You can pick it up whenever you want — nothing is lost in the meantime.
        </Notice>
      )}

      <header className="flex flex-col gap-2 pb-1">
        <h1 className="text-fg text-headline sm:text-display font-bold tracking-[-0.04em] text-balance">
          {headline}
        </h1>
        {projects.length > 0 && <p className="text-fg-muted text-lead">{summary}</p>}
      </header>

      {head === undefined ? (
        <EmptyDashboard />
      ) : (
        <>
          <DeskHead entry={head} />

          {/*
            An ordered list, because the order is the content. The stagger
            continues from the head — which is index 0 — so the screen arrives
            as one sequence rather than as a card and then a list.
          */}
          <ol className="flex flex-col gap-2.5" aria-label="Everything else on your desk">
            {rest.map((entry, position) => (
              <DeskRow key={entry.id} entry={entry} index={position + 1} />
            ))}
            <ConnectRow index={rest.length + 1} />
          </ol>
        </>
      )}
    </div>
  );
}

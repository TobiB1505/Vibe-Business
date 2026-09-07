import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { ArrowRightIcon, PlusIcon } from "@/components/ui/dashboard-icons";
import { buildAttentionItems, orderProjectsByAttention } from "@/modules/projects/attention";
import { productDisplayName } from "@/modules/projects/display-name";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { ProductCard } from "./product-card";
import { SignalCard } from "./signal-card";

/**
 * Everything the account dashboard puts on screen (CORE-6).
 *
 * ## Why the composition is a component and not the page
 *
 * Because the density budget is a claim about pixels, and the browser harness
 * renders components rather than pages — it has no database. A test that
 * re-assembled these three pieces itself would be measuring a screen that
 * exists only in the test file, and would keep passing after someone added a
 * fourth section to the real one. Rendering the same component the page
 * renders is what makes `e2e/account-dashboard.spec.ts` a budget rather than a
 * decoration.
 *
 * The page keeps what a page owns: the session, the reads, the redirects.
 *
 * ## The three objects, in the order they answer the question
 *
 * Where things stand for the product that needs attention *and* the one move
 * that follows from it, every product as an index, then the route to add
 * another. There is no attention list and no activity feed — both left in
 * CORE-6, and the ordering the attention list uniquely contributed is what
 * arranges the grid.
 *
 * It was four. The signal and the move were separate full-width panels with a
 * control each, which on an unanalysed product asked the same thing twice and
 * offered a button into an action plan that held nothing. `SignalCard` argues
 * the merge; what matters here is that the screen now has exactly one primary
 * object and the grid is a quiet index under it.
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
  const attention = buildAttentionItems(projects);
  const projectNames = new Map(
    projects.map((project) => [project.id, productDisplayName(project)]),
  );

  /*
   * Most-urgent first. The same ordering carries both halves of this screen:
   * the grid below, and the one product the hero panel is about — so the
   * headline and the cards under it can never disagree about which product
   * matters most.
   */
  const ordered = orderProjectsByAttention(projects);
  const hero = ordered[0] ?? null;

  /**
   * The headline states a fact or says there is nothing. No greeting by name
   * and no time of day: the session carries an email, not a name, and the
   * server's clock is not the user's. Inventing either would be exactly the
   * fake personalisation this product avoids.
   */
  const headline = projects.length === 0 ? "Welcome to Vibe Business." : "Welcome back.";

  const summary =
    attention.length === 0
      ? "Your business command center is up to date."
      : `${attention.length} ${attention.length === 1 ? "thing needs" : "things need"} your attention across your products.`;

  return (
    <div className="flex flex-col gap-7" data-testid="account-home">
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

      <header className="flex flex-col gap-2 pb-2">
        <h1 className="text-fg text-headline sm:text-display font-bold tracking-[-0.04em] text-balance">
          {headline}
        </h1>
        {projects.length > 0 && <p className="text-fg-muted text-lead">{summary}</p>}
      </header>

      {hero && (
        <SignalCard project={hero} />
      )}

      {projects.length === 0 ? (
        <EmptyDashboard />
      ) : (
        <section aria-labelledby="products-heading" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="products-heading" className="text-fg text-title font-bold">
              Your products
            </h2>
            <Link
              href="/app/products"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              View all products
              <ArrowRightIcon size={16} />
            </Link>
          </div>
          {/*
            Ordered by what needs attention, not by when it was created — that
            ordering is the one thing the removed attention list contributed
            that a card cannot, so the grid inherits it.
          */}
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ordered.map((project) => (
              <li key={project.id}>
                <ProductCard project={project} />
              </li>
            ))}
          </ul>

          {/*
            A route, not an offer. This carried a 64px mint tile and a
            two-line pitch, which gave a utility link the visual weight of the
            work above it — on a screen whose whole claim is that one thing
            matters most. One row, one sentence, one way in.
          */}
          <Surface
            level="section"
            padding="md"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="bg-mint-tint text-mint flex size-9 shrink-0 items-center justify-center rounded-nav"
              >
                <PlusIcon size={18} />
              </span>
              <h3 className="text-fg text-ui font-semibold">Connect a new product</h3>
            </div>
            <Link
              href="/app/connect/github"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Connect product
            </Link>
          </Surface>
        </section>
      )}
    </div>
  );
}

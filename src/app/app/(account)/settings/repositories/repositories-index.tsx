"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  BranchIcon,
  CodeIcon,
  LockIcon,
  PlusIcon,
  ProductsIcon,
  RepositoriesIcon,
  SearchIcon,
  SettingsIcon,
} from "@/components/ui/dashboard-icons";
import { DismissIcon, ExternalLinkIcon } from "@/components/ui/icons.generated";
import { GithubMark } from "@/components/brand/provider-marks";
import { Button, buttonClasses } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import type { ConnectedRepository } from "@/modules/projects/account-repositories";
import {
  filterAndSortRepositories,
  isRepositoryFilter,
  isRepositorySort,
  repositoryPage,
  repositoryPageSlice,
  type RepositoryFilter,
  type RepositorySort,
} from "./repository-list-state";
import { proseLinkClasses } from "@/components/ui/text-link";
import { SegmentedControl, SortSelect } from "@/components/ui/list-controls";
import { Figure } from "@/components/ui/figure";
import { EmptyState } from "@/components/ui/states";


function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-line-2 min-w-24 border-l pl-5 first:border-l-0 first:pl-0">
      <Figure value={value} tier="sm" label={label} />
    </div>
  );
}

function RepositoryTile({ repository }: { repository: ConnectedRepository }) {
  return (
    <span className="from-mint-tint to-surface-hover border-mint-line rounded-nav text-mint flex size-10 shrink-0 items-center justify-center border bg-gradient-to-br text-body font-bold">
      {repository.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function TrustItem({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="bg-mint-tint-soft text-mint rounded-nav flex size-9 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span>
        <strong className="text-fg-body block text-body font-semibold">{title}</strong>
        <span className="text-fg-muted mt-1 block text-caption leading-5">{description}</span>
      </span>
    </div>
  );
}

/**
 * What a customer sees after removing the GitHub App (VB-041).
 *
 * Wave 4 gave Vibe the ability to *notice* — a 404 on the installation probe
 * is GitHub's shape for "this App was removed", and it is recorded on the
 * installation row — and it gave "Connect GitHub" somewhere sensible to send
 * that user. What nothing did was **say so**, so this page went on describing
 * repositories as connected that Vibe could no longer read.
 *
 * The sentence is about access, not about the repository: the code is fine and
 * the customer's own settings are the reason. And it names the fix rather than
 * describing the problem, because removing an App is usually deliberate and
 * the only question left is how to undo it.
 */
function AccessRevokedNotice() {
  return (
    <p className="text-coral flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption">
      <span>Vibe can no longer read this repository — the GitHub App was removed.</span>
      <Link href="/app/connect/github?new=1" className={proseLinkClasses()}>
        Reconnect
      </Link>
    </p>
  );
}

/**
 * What a failed GitHub connection says, moved here from the account dashboard.
 *
 * The callback used to send failures to `/app`, which was a screen. `/app` is
 * a redirect now, so the message needed somewhere it could actually be read —
 * and this is the page about GitHub access, which is where a founder looks
 * after a connection did not work and where the control to try again already
 * is.
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

export function RepositoriesIndex({
  repositories,
  githubLogin,
}: {
  repositories: ConnectedRepository[];
  githubLogin: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramString = searchParams.toString();
  const currentQuery = searchParams.get("q") ?? "";
  const filter: RepositoryFilter = isRepositoryFilter(searchParams.get("visibility"))
    ? (searchParams.get("visibility") as RepositoryFilter)
    : "all";
  const sort: RepositorySort = isRepositorySort(searchParams.get("sort"))
    ? (searchParams.get("sort") as RepositorySort)
    : "recent";
  const requestedPage = repositoryPage(searchParams.get("page"));
  const searchRef = useRef<HTMLInputElement>(null);

  function replaceParams(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(paramString);
    update(params);
    const next = params.toString();
    window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
  }

  const filtered = useMemo(
    () => filterAndSortRepositories(repositories, { query: currentQuery, filter, sort }),
    [currentQuery, filter, repositories, sort],
  );
  const pagination = repositoryPageSlice(filtered, requestedPage);

  useEffect(() => {
    if (requestedPage === pagination.page) return;
    replaceParams((params) => {
      if (pagination.page === 1) params.delete("page");
      else params.set("page", String(pagination.page));
    });
    // replaceParams is intentionally recreated from the current URL snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, requestedPage]);

  const privateCount = repositories.filter((repository) => repository.private).length;
  const isConnected = Boolean(githubLogin || repositories.length);

  function setFilter(value: RepositoryFilter) {
    replaceParams((params) => {
      if (value === "all") params.delete("visibility");
      else params.set("visibility", value);
      params.delete("page");
    });
  }

  function setSort(value: RepositorySort) {
    replaceParams((params) => {
      if (value === "recent") params.delete("sort");
      else params.set("sort", value);
      params.delete("page");
    });
  }

  function clearSearchAndFilters() {
    replaceParams((params) => {
      params.delete("q");
      params.delete("visibility");
      params.delete("page");
    });
    searchRef.current?.focus();
  }

  const connectError = searchParams.get("connect_error");

  return (
    <div className="flex flex-col gap-7" data-testid="repositories-index">
      {connectError && (
        <Notice tone="problem" label="Connection failed">
          {CONNECT_ERROR_MESSAGES[connectError] ?? "GitHub connection failed. Please try again."}
        </Notice>
      )}

      <SectionHeader
        level={1}
        title="Repositories"
        description="Connect, review and manage the code behind your products."
        actions={
          <Link href="/app/connect/github" className={buttonClasses()}>
            <PlusIcon size={16} />
            Connect repository
          </Link>
        }
      />

      <Surface level="card" padding="md" className="overflow-hidden">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="bg-fg text-app rounded-card flex size-14 shrink-0 items-center justify-center">
              <GithubMark size={32} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                {/*
                  No "Connected" pill beside a heading that already says
                  "GitHub connected" (UI-31). A status mark that repeats the
                  words next to it is decoration, and this page has a real
                  status vocabulary two inches below it.
                */}
                <h2 className="text-fg text-title font-semibold">
                  {isConnected ? "GitHub connected" : "Connect GitHub"}
                </h2>
              </div>
              <p className="text-fg-muted mt-1 text-body">
                {githubLogin
                  ? `Vibe Business is connected to @${githubLogin}.`
                  : isConnected
                    ? "Your connected repositories are ready in Vibe Business."
                    : "Connect GitHub to add your first product repository."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            {/*
              Two numbers, and both are facts this page can compute.

              It printed four. **Products** was `repositories.length` under a
              second label — and the two part company the moment somebody
              presses Disconnect, which this product's own project settings
              offer and render ("No repository connected"). A project without a
              repository produces no row here, so the count was never the
              number of products; it was the number of repositories, said twice.

              **Public** went for a duller reason: repositories minus private.
              Three of the four numbers were one fact.
            */}
            <div className="flex items-center gap-6">
              <Metric value={repositories.length} label="Repositories" />
              <Metric value={privateCount} label="Private" />
            </div>
            {isConnected && (
              <a
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noreferrer noopener"
                // `whitespace-nowrap`: it wrapped to two lines at 1440 and
                // rendered 61px tall beside 40px controls.
                className={cn(buttonClasses({ variant: "secondary" }), "whitespace-nowrap")}
              >
                <SettingsIcon size={15} />
                Manage connection
              </a>
            )}
          </div>
        </div>
      </Surface>

      {repositories.length === 0 ? (
        <EmptyState
          as="h2"
          icon={<RepositoriesIcon size={22} />}
          title="No repositories connected"
          description="Connect a GitHub repository to create a product and give Vibe the bounded context it needs."
          action={
            <Link href="/app/connect/github" className={buttonClasses()}>
              Connect GitHub
            </Link>
          }
        />
      ) : (
        <Surface level="panel" padding="none" className="overflow-hidden">
          <div className="border-line-2 flex flex-col gap-4 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-fg text-title font-semibold">Connected repositories</h2>
              <p className="text-fg-meta mt-1 text-caption">
                Stored connection details, without unverified live activity.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {/* The ring goes on the label, for the reason `SortSelect`
                  records: the input carries `outline-none` and the border
                  colour it swapped in is 26% alpha. */}
              <label className="border-line-2 bg-field focus-within:border-mint-line has-[:focus-visible]:ring-mint has-[:focus-visible]:ring-2 rounded-nav flex min-w-0 items-center gap-2.5 border px-3.5 py-2.5 sm:w-64">
                <SearchIcon size={16} className="text-fg-meta shrink-0" />
                <span className="sr-only">Search repositories</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={currentQuery}
                  onChange={(event) => {
                    const value = event.target.value;
                    replaceParams((params) => {
                      if (value.trim()) params.set("q", value);
                      else params.delete("q");
                      params.delete("page");
                    });
                  }}
                  placeholder="Search repositories…"
                  className="text-fg-body placeholder:text-fg-meta min-w-0 flex-1 bg-transparent text-body outline-none"
                />
                {currentQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      replaceParams((params) => {
                        params.delete("q");
                        params.delete("page");
                      });
                      searchRef.current?.focus();
                    }}
                    aria-label="Clear repository search"
                    // `DismissIcon`, not `×`. A text character takes the
                    // font's weight instead of the icon frame's 1.5px and
                    // sits on the baseline rather than the optical centre —
                    // the defect the disclosure caret and `ArrowIcon` both
                    // record, in a third file.
                    className="text-fg-meta hover:text-fg rounded-inline transition-interactive shrink-0"
                  >
                    <DismissIcon size={14} />
                  </button>
                )}
              </label>

              {/* Three options, so all three are shown. A filter changes what
                  you are looking at rather than collecting an answer, and a
                  well said the opposite. */}
              <SegmentedControl
                label="Filter repository visibility"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "private", label: "Private" },
                  { value: "public", label: "Public" },
                ]}
              />

              {/* Sort keeps the pill: the orders are interchangeable and
                  nobody scans them, so there is nothing to gain by showing
                  them all. */}
              <SortSelect
                label="Sort repositories"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "recent", label: "Connected" },
                  { value: "name", label: "Repository" },
                  { value: "product", label: "Product" },
                ]}
              />
            </div>
          </div>

          {pagination.items.length > 0 ? (
            <>
              {/*
                One renderer (UI-31, treatment B).

                This was a `<table>` above `md` and a `<ul>` below — roughly a
                hundred lines each, hidden from one another by breakpoint, and
                already disagreeing about what a row contains: the table showed
                the name and `owner/name` and carried its own open-arrow, the
                list showed `fullName` and had neither.

                A grid earns its columns when a reader compares values down
                one, and nobody compares connection dates. What is left is a
                sequence — mark, repository, product, branch, state, when — and
                a sequence wraps, which is why the same row serves 390px and
                1440px with no second implementation to keep in step.
              */}
              <ul className="divide-line-2 divide-y">
                {pagination.items.map((repository) => (
                  <li
                    key={repository.projectId}
                    className="hover:bg-surface-hover transition-interactive flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"
                  >
                    <RepositoryTile repository={repository} />

                    <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      {/*
                        The repository leaves the product, so it carries the
                        turned arrow every other external link in Vibe does
                        (UI-30). The name leads and the owner follows: at 390px
                        the old title was `owner/name` truncated, which cut the
                        identifying half and kept the half that is identical on
                        every row.
                      */}
                      <a
                        href={repository.htmlUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-fg-body hover:text-fg rounded-inline transition-interactive inline-flex min-w-0 items-center gap-1.5 text-body font-semibold"
                      >
                        <span className="truncate">{repository.name}</span>
                        <ExternalLinkIcon size={13} className="text-fg-meta shrink-0" />
                      </a>
                      <Link
                        href={`/app/projects/${repository.projectId}`}
                        className="text-fg-muted hover:text-fg-body rounded-inline transition-interactive truncate text-caption"
                      >
                        {repository.projectName}
                      </Link>
                    </div>

                    <span className="text-fg-meta flex shrink-0 items-center gap-1.5 font-mono text-meta">
                      <BranchIcon size={13} />
                      {repository.defaultBranch}
                    </span>

                    <StatusPill tone={repository.accessRevokedAt ? "problem" : "neutral"}>
                      {repository.accessRevokedAt
                        ? "No access"
                        : repository.private
                          ? "Private"
                          : "Public"}
                    </StatusPill>

                    <span className="text-fg-meta shrink-0 text-caption whitespace-nowrap">
                      {formatTimestamp(repository.connectedAt)}
                    </span>

                    {repository.accessRevokedAt && (
                      <div className="basis-full">
                        <AccessRevokedNotice />
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div className="border-line-2 flex flex-col gap-3 border-t px-5 py-4 text-caption sm:flex-row sm:items-center sm:justify-between">
                <p className="text-fg-meta" aria-live="polite">
                  Showing {pagination.start + 1}–{pagination.end} of {filtered.length} repositories
                </p>
                {pagination.pageCount > 1 && (
                  <nav aria-label="Repository pages" className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={pagination.page === 1}
                      onClick={() =>
                        replaceParams((params) => params.set("page", String(pagination.page - 1)))
                      }
                      className={buttonClasses({ variant: "secondary" })}
                    >
                      Previous
                    </button>
                    <span className="text-fg-muted px-2" aria-current="page">
                      Page {pagination.page} of {pagination.pageCount}
                    </span>
                    <button
                      type="button"
                      disabled={pagination.page === pagination.pageCount}
                      onClick={() =>
                        replaceParams((params) => params.set("page", String(pagination.page + 1)))
                      }
                      className={buttonClasses({ variant: "secondary" })}
                    >
                      Next
                    </button>
                  </nav>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              as="h3"
              className="border-0 bg-transparent"
              title="No matching repositories"
              description="Try another repository, product or branch name, or reset the visibility filter."
              action={
                <Button variant="ghost" onClick={clearSearchAndFilters}>
                  Clear search and filters
                </Button>
              }
            />
          )}
        </Surface>
      )}

      <Surface level="section" padding="md">
        <h2 className="text-fg text-title font-semibold">How repositories are used</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <TrustItem
            icon={<CodeIcon size={17} />}
            title="Bounded analysis"
            description="Vibe reads only the targeted context needed for product intelligence."
          />
          <TrustItem
            icon={<ProductsIcon size={17} />}
            title="Product context"
            description="Each repository belongs to one product workspace and its business evidence."
          />
          <TrustItem
            icon={<LockIcon size={17} />}
            title="Secure by design"
            description="Repository access follows the permissions granted through your GitHub App installation."
          />
          <TrustItem
            icon={<RepositoriesIcon size={17} />}
            title="You stay in control"
            description="Manage repository access at any time from your GitHub installation settings."
          />
        </div>
      </Surface>
    </div>
  );
}

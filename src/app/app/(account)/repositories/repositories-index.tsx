"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  ArrowRightIcon,
  BranchIcon,
  CodeIcon,
  FilterIcon,
  LockIcon,
  PlusIcon,
  ProductsIcon,
  RepositoriesIcon,
  SearchIcon,
  SettingsIcon,
} from "@/components/ui/dashboard-icons";
import { buttonClasses } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
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

function GithubMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.88c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.55 9.55 0 0 1 12 6.8c.85 0 1.71.12 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-line-2 min-w-24 border-l pl-5 first:border-l-0 first:pl-0">
      <strong className="text-fg block text-xl font-bold tabular-nums">{value}</strong>
      <span className="text-fg-meta mt-0.5 block text-xs">{label}</span>
    </div>
  );
}

function RepositoryTile({ repository }: { repository: ConnectedRepository }) {
  return (
    <span className="from-mint-tint to-surface-hover border-mint-line rounded-nav text-mint flex size-10 shrink-0 items-center justify-center border bg-gradient-to-br text-sm font-bold">
      {repository.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function TrustItem({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="bg-mint-tint-soft text-mint rounded-nav flex size-9 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span>
        <strong className="text-fg-body block text-sm font-semibold">{title}</strong>
        <span className="text-fg-muted mt-1 block text-xs leading-5">{description}</span>
      </span>
    </div>
  );
}

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
  const publicCount = repositories.length - privateCount;
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

  return (
    <div className="flex flex-col gap-7" data-testid="repositories-index">
      <SectionHeader
        level={1}
        title="Repositories"
        description="Connect, review and manage the code behind your products."
        actions={
          <Link href="/app/connect/github" className={buttonClasses({ size: "sm" })}>
            <PlusIcon size={16} />
            Connect repository
          </Link>
        }
      />

      <Surface level="card" padding="md" className="overflow-hidden">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="bg-fg text-app rounded-card flex size-14 shrink-0 items-center justify-center">
              <GithubMark className="size-8" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-fg text-base font-semibold">
                  {isConnected ? "GitHub connected" : "Connect GitHub"}
                </h2>
                {isConnected && <StatusPill tone="success">Connected</StatusPill>}
              </div>
              <p className="text-fg-muted mt-1 text-sm">
                {githubLogin
                  ? `Vibe Business is connected to @${githubLogin}.`
                  : isConnected
                    ? "Your connected repositories are ready in Vibe Business."
                    : "Connect GitHub to add your first product repository."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:items-center">
              <Metric value={repositories.length} label="Repositories" />
              <Metric value={repositories.length} label="Products" />
              <Metric value={privateCount} label="Private" />
              <Metric value={publicCount} label="Public" />
            </div>
            {isConnected && (
              <a
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noreferrer noopener"
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                <SettingsIcon size={15} />
                Manage connection
              </a>
            )}
          </div>
        </div>
      </Surface>

      {repositories.length === 0 ? (
        <Surface level="panel" padding="lg" className="flex min-h-72 flex-col items-center justify-center text-center">
          <span className="bg-mint-tint-soft text-mint rounded-card flex size-12 items-center justify-center">
            <RepositoriesIcon size={22} />
          </span>
          <h2 className="text-fg mt-4 text-lg font-semibold">No repositories connected</h2>
          <p className="text-fg-muted mt-2 max-w-md text-sm leading-6">
            Connect a GitHub repository to create a product and give Vibe the bounded context it needs.
          </p>
          <Link href="/app/connect/github" className={cn(buttonClasses({ size: "sm" }), "mt-5")}>
            Connect GitHub
          </Link>
        </Surface>
      ) : (
        <Surface level="panel" padding="none" className="overflow-hidden">
          <div className="border-line-2 flex flex-col gap-4 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-fg text-base font-semibold">Connected repositories</h2>
              <p className="text-fg-meta mt-1 text-xs">Stored connection details, without unverified live activity.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="border-line-2 bg-field focus-within:border-mint-line rounded-nav flex min-w-0 items-center gap-2.5 border px-3.5 py-2.5 sm:w-64">
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
                  className="text-fg-body placeholder:text-fg-meta min-w-0 flex-1 bg-transparent text-sm outline-none"
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
                    className="text-fg-meta hover:text-fg rounded-sm px-1 text-base transition-interactive"
                  >
                    ×
                  </button>
                )}
              </label>

              {/* Native popup geometry is deliberate for these short, platform-standard option sets. */}
              <label className="border-line-2 bg-field rounded-nav text-fg-muted flex items-center gap-2 border px-3 py-2.5 text-sm">
                <FilterIcon size={15} />
                <span className="sr-only">Filter repository visibility</span>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as RepositoryFilter)}
                  className="text-fg-body bg-transparent text-sm font-medium outline-none"
                  aria-label="Filter repository visibility"
                >
                  <option value="all">All visibility</option>
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </label>

              <label className="border-line-2 bg-field rounded-nav flex items-center gap-2 border px-3 py-2.5">
                <span className="text-fg-meta text-xs font-medium">Sort:</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as RepositorySort)}
                  className="text-fg-body bg-transparent text-sm font-semibold outline-none"
                  aria-label="Sort repositories"
                >
                  <option value="recent">Connected</option>
                  <option value="name">Repository</option>
                  <option value="product">Product</option>
                </select>
              </label>
            </div>
          </div>

          {pagination.items.length > 0 ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="text-fg-meta text-xs">
                      <th scope="col" className="px-5 py-3 font-medium">Repository</th>
                      <th scope="col" className="px-5 py-3 font-medium">Product</th>
                      <th scope="col" className="px-5 py-3 font-medium">Connection</th>
                      <th scope="col" className="px-5 py-3 font-medium">Connected</th>
                      <th scope="col" className="w-16 px-5 py-3"><span className="sr-only">Open product</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagination.items.map((repository) => (
                      <tr key={repository.projectId} className="border-line-2 hover:bg-surface-hover border-t transition-interactive">
                        <td className="px-5 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <RepositoryTile repository={repository} />
                            <div className="min-w-0">
                              <a href={repository.htmlUrl} target="_blank" rel="noreferrer noopener" className="text-fg-body hover:text-mint block truncate text-sm font-semibold transition-interactive">
                                {repository.name}
                              </a>
                              <span className="text-fg-meta block truncate font-mono text-meta">{repository.owner}/{repository.name}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Link href={`/app/projects/${repository.projectId}`} className="text-fg-body hover:text-mint text-sm font-medium transition-interactive">{repository.projectName}</Link>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1.5">
                            <StatusPill tone="neutral">{repository.private ? "Private" : "Public"}</StatusPill>
                            <span className="text-fg-meta flex items-center gap-1.5 font-mono text-meta"><BranchIcon size={13} />{repository.defaultBranch}</span>
                          </div>
                        </td>
                        <td className="text-fg-muted px-5 py-4 text-sm">{formatTimestamp(repository.connectedAt)}</td>
                        <td className="px-5 py-4 text-right">
                          <Link href={`/app/projects/${repository.projectId}`} aria-label={`Open ${repository.projectName}`} className="border-line-2 text-fg-muted hover:border-mint-line hover:text-mint rounded-nav inline-flex size-9 items-center justify-center border transition-interactive"><ArrowRightIcon size={15} /></Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-line-2 divide-y md:hidden">
                {pagination.items.map((repository) => (
                  <li key={repository.projectId} className="p-5">
                    <div className="flex items-start gap-3">
                      <RepositoryTile repository={repository} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <a href={repository.htmlUrl} target="_blank" rel="noreferrer noopener" className="text-fg-body hover:text-mint block truncate text-sm font-semibold">{repository.fullName}</a>
                            <Link href={`/app/projects/${repository.projectId}`} className="text-fg-muted hover:text-mint mt-1 block text-xs">{repository.projectName}</Link>
                          </div>
                          <StatusPill tone="neutral">{repository.private ? "Private" : "Public"}</StatusPill>
                        </div>
                        <div className="text-fg-meta mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1.5 font-mono"><BranchIcon size={13} />{repository.defaultBranch}</span>
                          <span>{formatTimestamp(repository.connectedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="border-line-2 flex flex-col gap-3 border-t px-5 py-4 text-xs sm:flex-row sm:items-center sm:justify-between">
                <p className="text-fg-meta" aria-live="polite">
                  Showing {pagination.start + 1}–{pagination.end} of {filtered.length} repositories
                </p>
                {pagination.pageCount > 1 && (
                  <nav aria-label="Repository pages" className="flex items-center gap-2">
                    <button type="button" disabled={pagination.page === 1} onClick={() => replaceParams((params) => params.set("page", String(pagination.page - 1)))} className="border-line-2 text-fg-body hover:border-mint-line rounded-nav border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                    <span className="text-fg-muted px-2" aria-current="page">Page {pagination.page} of {pagination.pageCount}</span>
                    <button type="button" disabled={pagination.page === pagination.pageCount} onClick={() => replaceParams((params) => params.set("page", String(pagination.page + 1)))} className="border-line-2 text-fg-body hover:border-mint-line rounded-nav border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                  </nav>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center p-6 text-center" aria-live="polite">
              <SearchIcon size={22} className="text-fg-meta" />
              <h3 className="text-fg mt-4 text-base font-semibold">No matching repositories</h3>
              <p className="text-fg-muted mt-2 max-w-md text-sm">Try another repository, product or branch name, or reset the visibility filter.</p>
              <button type="button" onClick={clearSearchAndFilters} className="text-mint hover:text-mint-hover mt-5 rounded-sm text-sm font-semibold transition-interactive">Clear search and filters</button>
            </div>
          )}
        </Surface>
      )}

      <Surface level="section" padding="md">
        <h2 className="text-fg text-base font-semibold">How repositories are used</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <TrustItem icon={<CodeIcon size={17} />} title="Bounded analysis" description="Vibe reads only the targeted context needed for product intelligence." />
          <TrustItem icon={<ProductsIcon size={17} />} title="Product context" description="Each repository belongs to one product workspace and its business evidence." />
          <TrustItem icon={<LockIcon size={17} />} title="Secure by design" description="Repository access follows the permissions granted through your GitHub App installation." />
          <TrustItem icon={<RepositoriesIcon size={17} />} title="You stay in control" description="Manage repository access at any time from your GitHub installation settings." />
        </div>
      </Surface>
    </div>
  );
}

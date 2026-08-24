import type { ConnectedRepository } from "@/modules/projects/account-repositories";

export const REPOSITORIES_PAGE_SIZE = 5;

export type RepositoryFilter = "all" | "private" | "public";
export type RepositorySort = "recent" | "name" | "product";

export function isRepositoryFilter(value: string | null): value is RepositoryFilter {
  return value === "all" || value === "private" || value === "public";
}

export function isRepositorySort(value: string | null): value is RepositorySort {
  return value === "recent" || value === "name" || value === "product";
}

export function repositoryPage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function filterAndSortRepositories(
  repositories: ConnectedRepository[],
  options: { query: string; filter: RepositoryFilter; sort: RepositorySort },
): ConnectedRepository[] {
  const query = options.query.trim().toLocaleLowerCase();

  return repositories
    .filter((repository) => {
      if (options.filter === "private" && !repository.private) return false;
      if (options.filter === "public" && repository.private) return false;
      if (!query) return true;

      return [repository.fullName, repository.projectName, repository.defaultBranch].some((value) =>
        value.toLocaleLowerCase().includes(query),
      );
    })
    .toSorted((left, right) => {
      if (options.sort === "name") return left.fullName.localeCompare(right.fullName);
      if (options.sort === "product") return left.projectName.localeCompare(right.projectName);
      return Date.parse(right.connectedAt) - Date.parse(left.connectedAt);
    });
}

export function repositoryPageSlice(repositories: ConnectedRepository[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(repositories.length / REPOSITORIES_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * REPOSITORIES_PAGE_SIZE;

  return {
    page,
    pageCount,
    start,
    end: Math.min(start + REPOSITORIES_PAGE_SIZE, repositories.length),
    items: repositories.slice(start, start + REPOSITORIES_PAGE_SIZE),
  };
}

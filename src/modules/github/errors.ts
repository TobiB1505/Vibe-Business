/**
 * Typed domain errors for GitHub operations. Nothing outside
 * src/modules/github/ should ever inspect an Octokit/HTTP error directly
 * — callers switch on `code` and render their own user-facing copy, so
 * raw GitHub responses never reach the UI (Sprint 2 §33).
 */

export type GithubErrorCode =
  | "repository_not_found"
  | "github_access_revoked"
  | "github_contents_permission_required"
  | "repository_empty"
  | "github_rate_limited"
  | "github_api_error";

export class GithubDomainError extends Error {
  constructor(
    public readonly code: GithubErrorCode,
    /** Safe technical detail for server logs only — never rendered to users. */
    public readonly status?: number,
  ) {
    super(code);
    this.name = "GithubDomainError";
  }
}

type HttpLikeError = {
  status?: unknown;
  message?: unknown;
  response?: { headers?: Record<string, unknown> } | undefined;
};

function asHttpLike(error: unknown): HttpLikeError | null {
  if (!error || typeof error !== "object") return null;
  return error as HttpLikeError;
}

/**
 * Maps a raw GitHub/Octokit failure onto our domain error vocabulary.
 *
 * The 403 case is deliberately split: GitHub uses 403 both for
 * "your App lacks this permission" (the Contents:read upgrade case that
 * needs a specific, actionable UI) and for rate limiting. They're
 * distinguished by the rate-limit headers and message text, because
 * conflating them would show users a "grant permissions" prompt when the
 * real problem is a temporary rate limit.
 */
export function toGithubDomainError(error: unknown): GithubDomainError {
  const httpError = asHttpLike(error);
  const status = typeof httpError?.status === "number" ? httpError.status : undefined;
  const message = typeof httpError?.message === "string" ? httpError.message : "";

  if (status === 404) {
    return new GithubDomainError("repository_not_found", status);
  }

  if (status === 401) {
    return new GithubDomainError("github_access_revoked", status);
  }

  if (status === 409 || /empty/i.test(message)) {
    // GitHub answers 409 Conflict for git operations on a repository with
    // no commits yet.
    return new GithubDomainError("repository_empty", status ?? 409);
  }

  if (status === 403 || status === 429) {
    const remaining = httpError?.response?.headers?.["x-ratelimit-remaining"];
    const isRateLimited =
      status === 429 || remaining === "0" || remaining === 0 || /rate limit|secondary/i.test(message);
    if (isRateLimited) {
      return new GithubDomainError("github_rate_limited", status);
    }
    if (/not accessible by integration|resource not accessible/i.test(message)) {
      return new GithubDomainError("github_contents_permission_required", status);
    }
    // A 403 that is neither rate limiting nor a recognised permission
    // message is still most likely a missing-permission problem for our
    // read-only use case; treating it as such gives the user an
    // actionable next step rather than a dead end.
    return new GithubDomainError("github_contents_permission_required", status);
  }

  return new GithubDomainError("github_api_error", status);
}

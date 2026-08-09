import { describe, expect, it } from "vitest";
import { GithubDomainError, toGithubDomainError } from "./errors";

function httpError(status: number, message = "", headers: Record<string, unknown> = {}) {
  return { status, message, response: { headers } };
}

describe("toGithubDomainError", () => {
  it("maps 404 to repository_not_found", () => {
    expect(toGithubDomainError(httpError(404, "Not Found")).code).toBe("repository_not_found");
  });

  it("maps 401 to github_access_revoked", () => {
    expect(toGithubDomainError(httpError(401, "Bad credentials")).code).toBe("github_access_revoked");
  });

  it("maps 409 to repository_empty", () => {
    expect(toGithubDomainError(httpError(409, "Git Repository is empty.")).code).toBe("repository_empty");
  });

  it("maps a 403 with the integration-permission message to github_contents_permission_required", () => {
    const error = httpError(403, "Resource not accessible by integration", {
      "x-ratelimit-remaining": "4998",
    });
    expect(toGithubDomainError(error).code).toBe("github_contents_permission_required");
  });

  it("maps a 403 with exhausted rate limit to github_rate_limited, not a permission problem", () => {
    const error = httpError(403, "API rate limit exceeded", { "x-ratelimit-remaining": "0" });
    expect(toGithubDomainError(error).code).toBe("github_rate_limited");
  });

  it("maps 429 to github_rate_limited", () => {
    expect(toGithubDomainError(httpError(429, "Too many requests")).code).toBe("github_rate_limited");
  });

  it("maps an unknown status to github_api_error", () => {
    expect(toGithubDomainError(httpError(500, "Internal Server Error")).code).toBe("github_api_error");
  });

  it("maps a non-HTTP value to github_api_error rather than throwing", () => {
    expect(toGithubDomainError(new Error("socket hang up")).code).toBe("github_api_error");
    expect(toGithubDomainError(undefined).code).toBe("github_api_error");
  });

  it("produces a GithubDomainError instance carrying the status for server logs", () => {
    const mapped = toGithubDomainError(httpError(404, "Not Found"));
    expect(mapped).toBeInstanceOf(GithubDomainError);
    expect(mapped.status).toBe(404);
  });
});

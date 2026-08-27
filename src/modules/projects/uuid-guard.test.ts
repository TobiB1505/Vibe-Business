import { describe, expect, it, vi } from "vitest";

/**
 * VB-028 — a malformed project id is not-found, not a 500.
 *
 * `isUuid` is tested on its own; this proves the guard is *reached*, which is
 * where the original defect lived: the check was absent, not wrong. A route
 * parameter went straight into `.eq("id", …)`, PostgreSQL answered
 * `22P02 invalid input syntax for type uuid`, the store threw it, and the
 * request became a server error for something anyone can produce by typing.
 *
 * ## What this cannot show
 *
 * The audit's stated verification is `/app/projects/x` → 404, and that is not
 * observable from here. Signed out, the proxy redirects to login before the
 * page runs; signed in needs a real Supabase session, and the browser suite
 * deliberately points at a project that does not exist. So the status code
 * itself is unverified. What is verified is that the route calls `notFound()`
 * *before any query is built*, which is the step that used to throw.
 */

class NotFoundSignal extends Error {}

const notFoundMock = vi.fn(() => {
  throw new NotFoundSignal("NEXT_NOT_FOUND");
});
const requireSessionMock = vi.fn();
const getProjectWithRepositoryMock = vi.fn();

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock(), redirect: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ requireSession: () => requireSessionMock() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: vi.fn() }) }));
vi.mock("./queries", () => ({
  getProjectWithRepository: (...args: unknown[]) => getProjectWithRepositoryMock(...args),
}));

const { requireProjectAccess } = await import("./workspace-context");

describe("a malformed project id", () => {
  it("is refused before anything queries the database", async () => {
    vi.clearAllMocks();

    await expect(requireProjectAccess("x")).rejects.toBeInstanceOf(NotFoundSignal);

    expect(notFoundMock).toHaveBeenCalled();
    // The point of the fix: 22P02 came from the query, so the guard has to run
    // before one exists. Reaching a session lookup would be harmless; reaching
    // a query would mean the defect is still there.
    expect(getProjectWithRepositoryMock).not.toHaveBeenCalled();
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("lets a well-formed id through to the ownership check", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user_1" });
    getProjectWithRepositoryMock.mockResolvedValue(null);

    // Still not found — but for the real reason, reached through the query
    // rather than short-circuited by the shape check. Without this the guard
    // could refuse everything and the first test would still pass.
    await expect(
      requireProjectAccess("11111111-1111-4111-8111-111111111111"),
    ).rejects.toBeInstanceOf(NotFoundSignal);

    expect(getProjectWithRepositoryMock).toHaveBeenCalled();
  });
});

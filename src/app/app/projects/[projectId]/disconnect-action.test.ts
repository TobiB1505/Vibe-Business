import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VB-003 — a failed destructive operation is never presented as success.
 *
 * The defect these pin: `disconnectProjectAction` called `redirect("/app")`
 * outside the `result.ok` check, so a refused delete produced the same
 * navigation as a successful one. The project list reappeared still containing
 * the project, with no error shown and no audit event written.
 *
 * The redirect is the assertion. `redirect()` throws in Next.js, so "did we
 * navigate" is observable here as "did it throw", and a returned failure state
 * is by construction a call that did not navigate.
 */

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

const redirectMock = vi.fn((url: string) => {
  throw new RedirectSignal(url);
});
const requireSessionMock = vi.fn();
const disconnectProjectMock = vi.fn();
const recordAuditEventMock = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/modules/auth/session", () => ({ requireSession: () => requireSessionMock() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ __fake: "supabase" }) }));
vi.mock("@/modules/audit-log/events", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args),
}));
vi.mock("@/modules/operations/project-lifecycle/detach", () => ({
  detachRepository: (...args: unknown[]) => disconnectProjectMock(...args),
}));

vi.mock("@/modules/operations/project-lifecycle/service", () => ({
  deleteProjectLifecycle: vi.fn(),
}));

const { disconnectProjectAction } = await import("./actions");

const SERVER_USER = "user_from_session";
const PROJECT = "project_1";

/**
 * A deliberately hostile database message: schema names, a constraint, and a
 * token-shaped word. The store no longer returns one at all, so this is fed in
 * past the type to prove the action would still not surface it if a future
 * change reintroduced the field.
 */
const HOSTILE_DB_MESSAGE =
  'update or delete on table "projects" violates foreign key constraint ' +
  '"execution_specs_project_id_fkey" — secret';

/**
 * React calls the bound action with `(prevState, formData)`. The action
 * declares neither, so the extra arguments are passed and ignored — exercised
 * here exactly as `useActionState` would, to pin that this stays true.
 */
function invoke() {
  return (disconnectProjectAction as (p: string, ...rest: unknown[]) => ReturnType<
    typeof disconnectProjectAction
  >)(PROJECT, null, new FormData());
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue({ userId: SERVER_USER });
  recordAuditEventMock.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("success", () => {
  beforeEach(() => disconnectProjectMock.mockResolvedValue({ ok: true }));

  it("stays on the project, and only after the disconnect succeeded", async () => {
    await expect(invoke()).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith(`/app/projects/${PROJECT}/settings`);
  });

  it("records the disconnect audit event", async () => {
    await expect(invoke()).rejects.toThrow(RedirectSignal);
    expect(recordAuditEventMock).toHaveBeenCalledWith(expect.anything(), {
      userId: SERVER_USER,
      eventType: "project.disconnected",
      metadata: { projectId: PROJECT },
    });
  });

  /**
   * The owner used to travel down as an argument, and this pinned that it came
   * from `requireSession()` rather than the caller. VB-001 M1a moved the check
   * one layer further down: `disconnect_project()` reads `auth.uid()`, so
   * there is no owner argument at all — a `SECURITY DEFINER` function reachable
   * at `/rest/v1/rpc/` would treat one as a claim, not a check.
   *
   * What is left to assert is stronger: the action still refuses an
   * unauthenticated caller, and passes nothing an attacker could aim.
   */
  it("names no owner, because there is no owner argument to get wrong", async () => {
    await expect(invoke()).rejects.toThrow(RedirectSignal);

    expect(requireSessionMock).toHaveBeenCalled();
    expect(disconnectProjectMock).toHaveBeenCalledWith({ projectId: PROJECT, userId: SERVER_USER });

    const [params] = disconnectProjectMock.mock.calls[0] as [Record<string, unknown>];
    expect(params.userId).toBe(SERVER_USER);
  });

  it("still attributes the audit event to the session user", async () => {
    await expect(invoke()).rejects.toThrow(RedirectSignal);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: SERVER_USER }),
    );
  });
});

describe("failure: not_found", () => {
  beforeEach(() => disconnectProjectMock.mockResolvedValue({ ok: false, reason: "project_not_found" }));

  it("does not redirect", async () => {
    await expect(invoke()).resolves.toBeDefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns the closed failure code", async () => {
    await expect(invoke()).resolves.toEqual({ ok: false, error: "project_not_found" });
  });

  it("records no audit event, because the row could not be written", async () => {
    // `recordAuditEvent` resolves projectId into the real `project_id` column,
    // whose foreign key and insert policy both require the project to exist and
    // be the caller's. Neither holds here, so attempting the write would only
    // ever fail and log noise.
    await invoke();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it("never reports success", async () => {
    const state = await invoke();
    expect(state).not.toBeNull();
    expect(state).toMatchObject({ ok: false });
  });
});

describe("failure: internal database failure", () => {
  beforeEach(() => disconnectProjectMock.mockResolvedValue({ ok: false, reason: "detach_failed" }));

  it("does not redirect", async () => {
    await expect(invoke()).resolves.toBeDefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns the generic failure code", async () => {
    await expect(invoke()).resolves.toEqual({ ok: false, error: "detach_failed" });
  });

  it("returns nothing but the closed code", async () => {
    // No SQLSTATE, table, constraint or trigger name of any shape.
    expect(JSON.stringify(await invoke())).toBe('{"ok":false,"error":"detach_failed"}');
  });

  it("records a failure audit event carrying only bounded identifiers", async () => {
    await invoke();
    expect(recordAuditEventMock).toHaveBeenCalledWith(expect.anything(), {
      userId: SERVER_USER,
      eventType: "project.deletion_failed",
      metadata: { projectId: PROJECT, reason: "detach_failed" },
    });
  });

  it("logs no raw error to compensate for narrowing the store result", async () => {
    await invoke();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("failure: a hostile message reintroduced into the store result", () => {
  beforeEach(() =>
    // Past the type on purpose, twice over: the service's union has no
    // `message` arm and no `unknown` reason. This pins that the action's own
    // mapping — not merely the service's shape — is what keeps schema text away
    // from the browser, and that an unrecognised reason lands on a code the
    // button actually has copy for.
    disconnectProjectMock.mockResolvedValue({
      ok: false,
      reason: "unknown",
      message: HOSTILE_DB_MESSAGE,
    }),
  );

  it("surfaces none of it", async () => {
    const serialized = JSON.stringify(await invoke());

    expect(serialized).toBe('{"ok":false,"error":"detach_failed"}');
    for (const fragment of [
      HOSTILE_DB_MESSAGE,
      "execution_specs",
      "foreign key",
      "constraint",
      "projects",
      "secret",
    ]) {
      expect(serialized).not.toContain(fragment);
    }
  });

  it("keeps it out of the audit metadata too", async () => {
    await invoke();
    const [, params] = recordAuditEventMock.mock.calls[0] as [
      unknown,
      { metadata: Record<string, unknown> },
    ];
    expect(JSON.stringify(params.metadata)).not.toContain("secret");
    expect(JSON.stringify(params.metadata)).not.toContain("constraint");
  });

  it("still does not redirect", async () => {
    await expect(invoke()).resolves.toBeDefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The preview Server Action boundary (Sprint 10B-3 §5, §6, §9, §19, §20).
 *
 * These assert what the boundary exists to provide, and nothing the service
 * already owns:
 *
 *  - identity comes from the **server session**, never from an argument;
 *  - the confirmation reaches the service as an explicit value, so the modal is
 *    never the authority;
 *  - nothing provider-shaped — sandbox id, snapshot id, raw error — crosses
 *    back to the client;
 *  - the preview origin comes from an authorized read, never from a parameter.
 *
 * Business rules live in the service and are tested there. Duplicating them
 * here would let the two drift apart while both stayed green.
 */

const requireSessionMock = vi.fn();
const startChangePreviewMock = vi.fn();
const stopChangePreviewMock = vi.fn();
const getPreviewStatusMock = vi.fn();
const createProviderMock = vi.fn();
const executorMock = vi.fn();

vi.mock("@/modules/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: "supabase" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/modules/validation/vercel/provider", () => ({
  createVercelSandboxProvider: () => createProviderMock(),
}));

vi.mock("@/modules/operations/vercel/executor", () => ({
  VercelWorkflowExecutor: class {
    readonly name = "vercel_workflow";
    async start(input: unknown) {
      return executorMock(input);
    }
  },
}));

vi.mock("@/modules/change-preview/service", () => ({
  startChangePreview: (...args: unknown[]) => startChangePreviewMock(...args),
  stopChangePreview: (...args: unknown[]) => stopChangePreviewMock(...args),
  getPreviewStatus: (...args: unknown[]) => getPreviewStatusMock(...args),
}));

const { getPreviewStatusAction, startPreviewAction, stopPreviewAction } = await import(
  "./preview-actions"
);

const SERVER_USER = "user_from_session";
const PROJECT = "project_1";
const ARTIFACT = "validation_1";
const SESSION = "preview_1";

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue({ userId: SERVER_USER });
  createProviderMock.mockReturnValue({ id: "vercel_sandbox" });
  executorMock.mockResolvedValue({ ok: true, runId: "run_1" });

  startChangePreviewMock.mockResolvedValue({
    kind: "starting",
    previewSessionId: SESSION,
    operation: { operationId: "operation_1" },
  });
  stopChangePreviewMock.mockResolvedValue({
    kind: "stopping",
    previewSessionId: SESSION,
    operation: { operationId: "teardown_1" },
  });
  getPreviewStatusMock.mockResolvedValue({
    previewSessionId: SESSION,
    status: "running",
    stage: "completed",
    failureCode: null,
    expiresAt: "2026-08-13T12:15:00.000Z",
    readyAt: "2026-08-13T12:00:30.000Z",
    port: 3000,
    origin: "https://sandbox-3000.vercel.run",
    verdict: "preview_available",
  });
});

describe("starting a preview", () => {
  it("takes the user from the session, never from an argument", async () => {
    await startPreviewAction(PROJECT, ARTIFACT, true);

    expect(startChangePreviewMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ userId: SERVER_USER, projectId: PROJECT }),
    );
  });

  it("passes the confirmation through to the service as an explicit value", async () => {
    await startPreviewAction(PROJECT, ARTIFACT, true);

    // The dialog closing is not what authorizes this. The service checks the
    // boolean before an operation row exists, and this is the wire it travels
    // on (§5).
    expect(startChangePreviewMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ confirmPublicExposure: true }),
    );
  });

  it("forwards a missing confirmation rather than substituting one", async () => {
    startChangePreviewMock.mockResolvedValue({
      kind: "failed",
      error: "preview_exposure_not_confirmed",
    });

    const result = await startPreviewAction(PROJECT, ARTIFACT, false);

    expect(startChangePreviewMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ confirmPublicExposure: false }),
    );
    // Safe copy, and the code, so a caller can branch without parsing prose.
    expect(result).toMatchObject({ ok: false, error: "preview_exposure_not_confirmed" });
    expect(result.ok === false && result.message).toContain("confirm");
  });

  it("accepts no parameter that could name a snapshot, sandbox, port or command", async () => {
    await startPreviewAction(PROJECT, ARTIFACT, true);

    // The whole payload the service receives. Everything consequential is
    // server-resolved, and the assertion is against the *keys* rather than the
    // values, because a widened input surface is what would break it (§6).
    const [, , params] = startChangePreviewMock.mock.calls[0];
    expect(Object.keys(params as object).sort()).toEqual([
      "confirmPublicExposure",
      "preparedChangeId",
      "projectId",
      "userId",
    ]);
  });

  it("returns a session id and an operation id on a start", async () => {
    expect(await startPreviewAction(PROJECT, ARTIFACT, true)).toEqual({
      ok: true,
      kind: "starting",
      previewSessionId: SESSION,
      operationId: "operation_1",
    });
  });

  it("reports a reuse rather than a second start", async () => {
    startChangePreviewMock.mockResolvedValue({
      kind: "reused",
      previewSessionId: SESSION,
      status: "running",
    });

    expect(await startPreviewAction(PROJECT, ARTIFACT, true)).toEqual({
      ok: true,
      kind: "reused",
      previewSessionId: SESSION,
      status: "running",
    });
  });

  it("maps a failure to safe copy, never a provider message", async () => {
    startChangePreviewMock.mockResolvedValue({ kind: "failed", error: "preview_provider_unavailable" });

    const result = await startPreviewAction(PROJECT, ARTIFACT, true);

    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/vercel|sandbox_|snap_|stack|at Object\./i);
  });
});

describe("reading a preview", () => {
  it("resolves the origin through the authorized service read", async () => {
    const result = await getPreviewStatusAction(PROJECT, SESSION);

    expect(getPreviewStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      // The executor: an expired session hands itself to the durable teardown,
      // which is the only place allowed to write the usage ledger.
      expect.anything(),
      expect.objectContaining({ userId: SERVER_USER, projectId: PROJECT, previewSessionId: SESSION }),
    );
    expect(result).toMatchObject({ ok: true, origin: "https://sandbox-3000.vercel.run" });
  });

  it("accepts no client-supplied origin or sandbox reference", async () => {
    // Two arguments, both identifiers. There is no parameter through which a
    // caller could assert what the preview URL is (§9, §20).
    expect(getPreviewStatusAction.length).toBe(2);
  });

  it("returns nothing when the service refuses", async () => {
    // Cross-user, wrong project, unknown session — the service answers null to
    // all of them, and the boundary must not invent a shape.
    getPreviewStatusMock.mockResolvedValue(null);

    expect(await getPreviewStatusAction(PROJECT, SESSION)).toEqual({ ok: false });
  });

  it("returns no origin for a stopped session", async () => {
    getPreviewStatusMock.mockResolvedValue({
      previewSessionId: SESSION,
      status: "stopped",
      stage: "completed",
      failureCode: null,
      expiresAt: "2026-08-13T12:15:00.000Z",
      readyAt: null,
      port: 3000,
      origin: null,
      verdict: null,
    });

    const result = await getPreviewStatusAction(PROJECT, SESSION);

    expect(result).toMatchObject({ ok: true, origin: null, verdict: null });
  });

  it("never leaks a provider sandbox identifier to the client", async () => {
    const result = await getPreviewStatusAction(PROJECT, SESSION);

    expect(JSON.stringify(result)).not.toMatch(/snap_|sandbox_id|vibe-preview-/);
  });
});

describe("stopping a preview", () => {
  it("takes the user from the session and requests teardown exactly once", async () => {
    const result = await stopPreviewAction(PROJECT, SESSION);

    expect(stopChangePreviewMock).toHaveBeenCalledTimes(1);
    expect(stopChangePreviewMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ userId: SERVER_USER, previewSessionId: SESSION }),
    );
    expect(result).toEqual({ ok: true, kind: "stopping" });
  });

  it("reports an already-stopped session as a result, not an error", async () => {
    stopChangePreviewMock.mockResolvedValue({
      kind: "already_stopped",
      previewSessionId: SESSION,
      status: "stopped",
    });

    // A double click must produce one logical result. The idempotency is the
    // service's; this asserts the boundary does not turn it into an error the
    // user sees (§12, §21).
    expect(await stopPreviewAction(PROJECT, SESSION)).toEqual({
      ok: true,
      kind: "already_stopped",
    });
  });

  it("surfaces an authorization failure as safe copy", async () => {
    stopChangePreviewMock.mockResolvedValue({ kind: "failed", error: "project_not_found" });

    const result = await stopPreviewAction(PROJECT, SESSION);

    expect(result.ok).toBe(false);
    // Deliberately not "you do not own this preview": a caller who guessed a
    // session id learns nothing about whether it exists.
    expect(result.ok === false && result.message).toBe("This preview could not be stopped.");
  });
});

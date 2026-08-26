import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The service-role write path for a founder input resolution.
 *
 * This file exists because its absence hid a defect. `resolveFounderInput`
 * classifies the RPC's `raise exception` text into seven closed outcomes, and
 * every one of them was unreachable: the classifier tested `error instanceof
 * Error`, while supabase-js hands back a plain object on its default path. The
 * shape is what these tests pin — not the wording of any one message.
 */

const createServiceClientMock = vi.fn();
const getFounderInputRequestMock = vi.fn();
const callResolveMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/modules/founder-input/store", () => ({
  getFounderInputRequest: (...args: unknown[]) => getFounderInputRequestMock(...args),
  callResolveFounderInputRequest: (...args: unknown[]) => callResolveMock(...args),
}));

const { resolveFounderInput } = await import("./server-writes");

const PROJECT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const REQUEST = "33333333-3333-3333-3333-333333333333";

/** A request answerable by picking its one alternative. */
function openRequest() {
  return {
    id: REQUEST,
    projectId: PROJECT,
    kind: "decision" as const,
    subjectKey: "pricing.model",
    question: "Which pricing model should Vibe assume?",
    whyNeeded: "The plan step depends on it.",
    responseType: "single_select" as const,
    recommendation: null,
    alternatives: [{ id: "option-1", label: "Flat monthly", value: "Flat monthly", explanation: null }],
    allowCustom: false,
    contextHash: "c".repeat(64),
    status: "open" as const,
  };
}

/** supabase-js returns the parsed body — a plain object, never an `Error`. */
function postgrestError(message: string) {
  return { message, details: "", hint: "", code: "P0001" };
}

function ownedProject() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: PROJECT }, error: null }) }) }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createServiceClientMock.mockReturnValue(ownedProject());
  getFounderInputRequestMock.mockResolvedValue(openRequest());
});

function invoke() {
  return resolveFounderInput({
    projectId: PROJECT,
    userId: USER,
    requestId: REQUEST,
    expectedContextHash: "c".repeat(64),
    response: { source: "option", selectedOptionId: "option-1" },
  });
}

describe("a PL/pgSQL raise is classified, not swallowed", () => {
  it.each([
    ["founder_input_request_not_found", "request_not_found"],
    ["founder_input_request_not_open", "request_not_open"],
    ["stale_founder_input_request", "stale_request"],
    ["runtime_founder_input_reservation_still_active", "execution_not_settled"],
    ["founder_input_answer_invalid", "invalid_response"],
  ])("maps %s to %s", async (raised, expected) => {
    callResolveMock.mockRejectedValue(postgrestError(raised));
    await expect(invoke()).resolves.toEqual({ ok: false, error: expected });
  });

  it("keeps the billing guard distinguishable from a generic failure", async () => {
    // The one that cost the most: a founder answering while the Credit hold is
    // still active must not be told to try again, because trying again cannot
    // work — only waiting does.
    callResolveMock.mockRejectedValue(
      postgrestError("runtime_founder_input_reservation_still_active"),
    );
    const result = await invoke();
    expect(result).toEqual({ ok: false, error: "execution_not_settled" });
    expect(result).not.toEqual({ ok: false, error: "resolution_failed" });
  });

  it("still classifies a genuinely thrown Error", async () => {
    callResolveMock.mockRejectedValue(new Error("stale_founder_input_request"));
    await expect(invoke()).resolves.toEqual({ ok: false, error: "stale_request" });
  });

  it("falls back to resolution_failed for an unrecognised failure", async () => {
    callResolveMock.mockRejectedValue(postgrestError("connection reset by peer"));
    await expect(invoke()).resolves.toEqual({ ok: false, error: "resolution_failed" });
  });

  it("never returns the raw database text", async () => {
    const raw = 'permission denied for relation "project_founder_resolutions" — secret';
    callResolveMock.mockRejectedValue(postgrestError(raw));
    const serialized = JSON.stringify(await invoke());
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("permission denied");
    expect(serialized).toBe('{"ok":false,"error":"resolution_failed"}');
  });
});

describe("ownership", () => {
  it("refuses a project the caller does not own", async () => {
    createServiceClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      }),
    });
    await expect(invoke()).resolves.toEqual({ ok: false, error: "project_not_found" });
    expect(callResolveMock).not.toHaveBeenCalled();
  });

  it("refuses a request belonging to another project", async () => {
    getFounderInputRequestMock.mockResolvedValue({ ...openRequest(), projectId: "other" });
    await expect(invoke()).resolves.toEqual({ ok: false, error: "request_not_found" });
    expect(callResolveMock).not.toHaveBeenCalled();
  });
});

describe("success", () => {
  it("returns the resolution id", async () => {
    callResolveMock.mockResolvedValue("44444444-4444-4444-4444-444444444444");
    await expect(invoke()).resolves.toEqual({
      ok: true,
      resolutionId: "44444444-4444-4444-4444-444444444444",
    });
  });
});

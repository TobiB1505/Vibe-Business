import { tokenAuthorizesModel, type AgentGatewayClaims } from "./gateway-token";

/**
 * What the Agent Gateway decides, expressed without any I/O
 * (EXECUTION CORE-4 runtime placement).
 *
 * ## Why this is a separate file from the route
 *
 * Because the route is the one place in this product that turns an untrusted
 * caller's request into a request carrying Vibe's real Anthropic key, and a
 * decision that can only be exercised by standing up a Next.js handler, a
 * database and a network is a decision nobody tests exhaustively. Every refusal
 * below is reachable from a plain function call.
 *
 * ## The two authorities, restated for a proxy
 *
 * ```
 * the signature   did Vibe issue this token, for this route and this model?
 * durable state   is the run still live, and is the budget still unspent?
 * ```
 *
 * `gateway-token.ts` answers the first and cannot answer the second: a
 * signature is fixed at minting time, and cancellation and spend both happen
 * afterwards. This module takes both halves and refuses if either says no —
 * the same shape ADR 0019 requires before a merge, applied one layer down.
 */

/**
 * Run states in which the gateway will still forward.
 *
 * `running` only. Not `queued` — a run whose sandbox has not started has no
 * business sampling. Not `paused` — a run stopped on a customer question must
 * not keep spending while it waits. Not any terminal state, which is what makes
 * cancellation a real revocation rather than a label.
 */
const FORWARDABLE_RUN_STATUSES: readonly string[] = ["running"];

export const AGENT_GATEWAY_REFUSALS = [
  /** No credential presented at all. */
  "missing_token",
  /** The token did not verify — see `AgentGatewayTokenRejection` for which way. */
  "token_rejected",
  /** The body named a model the token does not authorize. */
  "model_not_authorized",
  /** The body could not be read as a sampling request. */
  "malformed_request",
  /** No agent run exists for this token's claims. */
  "run_not_found",
  /** The run is cancelled, finished, paused, or not yet started. */
  "run_not_live",
  /** The run's own identity disagrees with the token's other claims. */
  "run_binding_mismatch",
  /** The authorized output-token ceiling is already reached. */
  "budget_exhausted",
  /** The authorized request count is already reached. */
  "request_limit_reached",
] as const;
export type AgentGatewayRefusal = (typeof AGENT_GATEWAY_REFUSALS)[number];

/** The durable half, read fresh on every request. */
export type AgentRunGatewayState = {
  status: string;
  projectId: string;
  userId: string;
  executionSpecId: string;
  /** Output tokens already billed to this run, from the usage ledger. */
  spentOutputTokens: number;
  /** Gateway requests already forwarded for this run. */
  forwardedRequests: number;
};

export type AgentGatewayDecision =
  /**
   * The run this decision was made about, carried out rather than re-read.
   *
   * A caller that has been told "yes" needs the state the yes was based on —
   * the remaining budget, for one — and looking it up again would be a second
   * read that could disagree with the one that authorized (VB-016).
   */
  | { ok: true; run: AgentRunGatewayState }
  | { ok: false; refusal: AgentGatewayRefusal; status: number };

/**
 * Whether this request may be forwarded with Vibe's real key.
 *
 * Total, and ordered cheapest-first: identity before state, state before
 * arithmetic. The ordering is not only about cost — a request that fails the
 * binding check must not have its budget consulted, because "how much has that
 * run spent" is not a question a stranger's token gets an answer to.
 */
/**
 * The request body with `max_tokens` lowered to what the run may still spend
 * (VB-016).
 *
 * ## Why lowering rather than refusing
 *
 * Because a call asking for more than the remaining budget is not a hostile
 * call — it is the SDK asking for its usual ceiling near the end of a run, and
 * refusing it would end the run one turn early for a reason the customer never
 * chose. Lowering lets it finish inside the authorization.
 *
 * ## What it never does
 *
 * Raise. A caller asking for less than it may have keeps its own number: the
 * budget is a ceiling, not an allowance to be spent.
 *
 * Anything that is not an object is returned untouched — a body the API will
 * reject is not this function's problem, and inventing a shape for it would be
 * this gateway making up a request the sandbox did not send.
 */
export function clampMaxTokens(body: unknown, remaining: number): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;

  const requested = (body as { max_tokens?: unknown }).max_tokens;
  if (typeof requested !== "number" || !Number.isFinite(requested)) return body;
  if (requested <= remaining) return body;

  return { ...(body as Record<string, unknown>), max_tokens: remaining };
}

export function authorizeGatewayRequest(input: {
  claims: AgentGatewayClaims;
  run: AgentRunGatewayState | null;
  /** The `model` field of the request body, unparsed and untrusted. */
  requestedModel: unknown;
}): AgentGatewayDecision {
  if (!tokenAuthorizesModel(input.claims, input.requestedModel)) {
    return { ok: false, refusal: "model_not_authorized", status: 403 };
  }

  const { run } = input;
  if (!run) return { ok: false, refusal: "run_not_found", status: 403 };

  /*
   * Every identity on the token is re-checked against the stored row.
   *
   * The signature already proves Vibe issued these claims — but it proves that
   * about the *token*, not about the world the token now finds itself in. A run
   * that was re-created, re-owned or re-specced is not the run this token was
   * minted for, and forwarding would be spending one project's Credits under
   * another project's authorization.
   */
  if (
    run.projectId !== input.claims.projectId ||
    run.userId !== input.claims.userId ||
    run.executionSpecId !== input.claims.specId
  ) {
    return { ok: false, refusal: "run_binding_mismatch", status: 403 };
  }

  // Revocation, and the only mechanism for it: cancelling a run is a status
  // change, and the next sampling request is refused because of it.
  if (!FORWARDABLE_RUN_STATUSES.includes(run.status)) {
    return { ok: false, refusal: "run_not_live", status: 403 };
  }

  /*
   * The ceilings are `>=`, deliberately.
   *
   * A run that has exactly reached its authorized maximum has no authorization
   * left for the next request. Reading this as `>` would permit one extra call
   * past every ceiling the customer approved — small, and exactly the kind of
   * off-by-one that turns a hard limit into a soft one.
   */
  if (run.forwardedRequests >= input.claims.maxRequests) {
    return { ok: false, refusal: "request_limit_reached", status: 429 };
  }

  if (run.spentOutputTokens >= input.claims.maxOutputTokens) {
    return { ok: false, refusal: "budget_exhausted", status: 429 };
  }

  return { ok: true, run };
}

/**
 * What a refused caller is told.
 *
 * Deliberately uninformative. The caller is a sandbox running a customer's
 * repository under a model that reads that repository, so a refusal that
 * explained *which* binding failed would be a probing oracle: mint attempts, or
 * an injected instruction, could walk the claim space one message at a time.
 *
 * The precise reason is logged server-side, where the person debugging it can
 * see it and the sandbox cannot.
 */
export function gatewayRefusalBody(): { error: { type: string; message: string } } {
  return {
    error: {
      type: "authentication_error",
      message: "This request is not authorized for the current execution.",
    },
  };
}

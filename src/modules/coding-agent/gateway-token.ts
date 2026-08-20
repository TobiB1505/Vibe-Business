import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The execution-scoped token the agent sandbox holds instead of a credential
 * (EXECUTION CORE-4 runtime placement).
 *
 * ## What replaced what
 *
 * The sandbox used to be handed nothing, because the Agent SDK ran inside the
 * Vercel function. It cannot: the SDK spawns a ~325 MB native `claude` binary,
 * which is neither installed in a serverless bundle nor able to fit one. So the
 * SDK moves into the sandbox — and the sandbox is a VM that runs a customer's
 * repository, which is the last place Vibe's Anthropic key may ever be.
 *
 * Anthropic's own guidance names the answer (*Secure deployment* → The proxy
 * pattern): run a proxy outside the agent's boundary that injects the credential,
 * and point the subprocess at it with `ANTHROPIC_BASE_URL`. This token is what
 * the sandbox carries in place of the key.
 *
 * ## Why it is signed rather than looked up
 *
 * A random opaque id would need a database round trip on the gateway's hot path
 * and a row per run. A signed token carries its own claims, so the gateway can
 * reject a forged, expired, wrong-model or wrong-route request **before** it
 * touches Postgres — and still consults durable state for the two things a
 * signature cannot express: revocation and spend.
 *
 * That split is deliberate. Signature answers *"did Vibe issue this, and for
 * what?"*. The database answers *"is it still true?"*. Neither substitutes for
 * the other, which is the same two-authority shape ADR 0019 requires for a
 * merge.
 *
 * ## What is deliberately not in it
 *
 * No Anthropic key, obviously — but also no repository URL, no GitHub
 * installation id, no Supabase reference, and no prompt. The token is an
 * authorization, not a payload: everything it names is an identifier Vibe can
 * resolve on its own side, so a leaked token discloses nothing beyond the fact
 * that a run exists.
 */

/** Bumped when the claim set changes in a way an old token must not satisfy. */
export const AGENT_GATEWAY_TOKEN_VERSION = "agent-gateway-token-v1" as const;

/**
 * The single Anthropic route an agent run may reach.
 *
 * One value, not a list. The Agent SDK samples through `/v1/messages` and
 * nothing else, so a token that could name a second route would be describing a
 * capability the product does not have — and `/v1/organizations`,
 * `/v1/files` or an admin route reached with Vibe's real key is exactly the
 * escalation this whole arrangement exists to prevent.
 */
export const AGENT_GATEWAY_ROUTES = ["/v1/messages"] as const;
export type AgentGatewayRoute = (typeof AGENT_GATEWAY_ROUTES)[number];

/**
 * Everything the gateway must be able to check before it injects a credential.
 *
 * Each field is a binding the sprint requires, and each one is here because a
 * token missing it would authorize something nobody decided:
 *
 * | Claim | What it stops |
 * | --- | --- |
 * | `runId` | one run's token driving another run's spend |
 * | `specId` | a run continuing against a re-resolved instruction package |
 * | `projectId` / `userId` | a token crossing a tenancy boundary |
 * | `model` | the sandbox choosing a model nobody priced |
 * | `route` | reaching any Anthropic API but sampling |
 * | `maxOutputTokens` / `maxRequests` | spending past the authorized ceiling |
 * | `expiresAt` | a token outliving the run it belongs to |
 */
export type AgentGatewayClaims = {
  version: typeof AGENT_GATEWAY_TOKEN_VERSION;
  /** The agent run row. The gateway's key for revocation and spend. */
  runId: string;
  /** The immutable instruction package this run executes. */
  specId: string;
  projectId: string;
  userId: string;
  /** Exactly one model id. Not a family, not a prefix. */
  model: string;
  route: AgentGatewayRoute;
  /** Ceiling for the whole run, not per request. */
  maxOutputTokens: number;
  /** Ceiling on gateway requests, so a loop cannot spin without spending. */
  maxRequests: number;
  /** Unix milliseconds. */
  expiresAt: number;
};

export type AgentGatewayTokenRejection =
  | "malformed"
  | "unknown_version"
  | "bad_signature"
  | "expired"
  | "route_not_authorized"
  | "model_not_authorized";

export type AgentGatewayTokenVerdict =
  | { ok: true; claims: AgentGatewayClaims }
  | { ok: false; rejection: AgentGatewayTokenRejection };

/* ---------------------------------------------------------------------------
 * Minting
 * ------------------------------------------------------------------------ */

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Mints one token for one run.
 *
 * Deliberately takes the secret as an argument rather than reading the
 * environment: this module is pure, so the whole claim set can be tested
 * exhaustively without a key, a clock or a database — which is the only way the
 * refusal cases below get covered at all.
 */
export function mintAgentGatewayToken(claims: AgentGatewayClaims, secret: string): string {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
}

/* ---------------------------------------------------------------------------
 * Verification
 * ------------------------------------------------------------------------ */

/**
 * Verifies a token's signature and its self-describing claims.
 *
 * **This is not the whole gate.** It answers "did Vibe issue this, for this
 * route and this model, and is it still inside its lifetime". It cannot answer
 * whether the run was cancelled or whether the budget is already spent — those
 * are properties of durable state, and `route.ts` checks them after this
 * returns. A caller that treats an `ok: true` here as permission to forward has
 * used half the gate.
 */
export function verifyAgentGatewayToken(
  token: string,
  input: { secret: string; route: string; now?: Date },
): AgentGatewayTokenVerdict {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return { ok: false, rejection: "malformed" };
  }

  const [payload, signature] = parts;

  /*
   * Constant-time, and length-checked first.
   *
   * `timingSafeEqual` throws on a length mismatch rather than returning false,
   * so the length check is not an optimisation — without it a forged token of
   * the wrong length would crash the gateway instead of being refused.
   */
  const expected = Buffer.from(sign(payload, input.secret), "utf8");
  const provided = Buffer.from(signature, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, rejection: "bad_signature" };
  }

  let claims: AgentGatewayClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AgentGatewayClaims;
  } catch {
    return { ok: false, rejection: "malformed" };
  }

  if (claims?.version !== AGENT_GATEWAY_TOKEN_VERSION) {
    return { ok: false, rejection: "unknown_version" };
  }

  if (!isCompleteClaimSet(claims)) return { ok: false, rejection: "malformed" };

  const now = (input.now ?? new Date()).getTime();
  if (!(claims.expiresAt > now)) return { ok: false, rejection: "expired" };

  // Exact match. A prefix test would let `/v1/messages/../organizations`
  // through, and a normalising comparison is a parser nobody reviewed.
  if (claims.route !== input.route) return { ok: false, rejection: "route_not_authorized" };

  return { ok: true, claims };
}

/**
 * Whether a request's model matches the one this token authorizes.
 *
 * Separate from `verifyAgentGatewayToken` because the model arrives in the
 * request *body*, which the gateway parses after the signature is established —
 * verifying a claim against a body it has not yet trusted would be backwards.
 */
export function tokenAuthorizesModel(claims: AgentGatewayClaims, model: unknown): boolean {
  return typeof model === "string" && model === claims.model;
}

/**
 * A missing claim is a malformed token, not a permissive default.
 *
 * Written out field by field rather than inferred from a schema library: this
 * is the list a reviewer has to read, and an `as` cast on parsed JSON asserts
 * nothing at runtime.
 */
function isCompleteClaimSet(claims: AgentGatewayClaims): boolean {
  return (
    typeof claims.runId === "string" &&
    claims.runId.length > 0 &&
    typeof claims.specId === "string" &&
    claims.specId.length > 0 &&
    typeof claims.projectId === "string" &&
    claims.projectId.length > 0 &&
    typeof claims.userId === "string" &&
    claims.userId.length > 0 &&
    typeof claims.model === "string" &&
    claims.model.length > 0 &&
    (AGENT_GATEWAY_ROUTES as readonly string[]).includes(claims.route) &&
    Number.isInteger(claims.maxOutputTokens) &&
    claims.maxOutputTokens > 0 &&
    Number.isInteger(claims.maxRequests) &&
    claims.maxRequests > 0 &&
    Number.isFinite(claims.expiresAt)
  );
}

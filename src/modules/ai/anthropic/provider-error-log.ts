import type { ProviderErrorDiagnostic } from "../provider";

/**
 * Opt-in, server-only diagnostic logging for a *rejected* provider request.
 *
 * This exists for one narrow job: a deterministic `400 invalid_request_error`
 * tells us the payload we built is wrong, but not which field. The provider's
 * own message names the field. We deliberately never persist that message
 * (Sprint 4 §27, §37: the usage ledger and audit log store closed-set codes,
 * never prose), so without this channel the only way to read it is the
 * Anthropic console.
 *
 * The rules this module exists to enforce:
 *
 *  - It writes to the **process log only** — never Postgres, never audit-event
 *    metadata, never a response body, never the browser.
 *  - It logs exactly four fields: HTTP status, the typed `error.type`, the
 *    request id, and a sanitized message. There is no parameter for request
 *    params, prompts, evidence, headers, tokens, or a raw response body,
 *    because a field that does not exist cannot be filled in by mistake.
 *  - It is **off in production unless explicitly enabled**, so ordinary
 *    behaviour is unchanged: callers still receive the same typed
 *    `provider_request_rejected` with the same closed-set diagnostic.
 */

/** The complete set of fields this channel can emit. */
export type RejectedRequestLogDetail = ProviderErrorDiagnostic & {
  /** The provider's own sanitized message, or null when unusable. */
  providerMessage: string | null;
};

export type ProviderErrorLogSink = (message: string, detail: RejectedRequestLogDetail) => void;

/** Bounds how much provider prose can reach a log line. */
const MAX_MESSAGE_LENGTH = 400;

/**
 * Enabled outside production, or in production only when explicitly opted in.
 *
 * The explicit flag is the point rather than an escape hatch: this class of
 * bug reproduces on the deployed runtime, where `NODE_ENV` is `production`.
 * Gating on the environment alone would put the diagnostic everywhere except
 * where the failure happens. The flag is meant to be set for a single
 * reproduction and removed again.
 */
export function isProviderErrorLoggingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.AI_DEBUG_PROVIDER_ERRORS === "1") return true;
  // `test` is excluded alongside `production`: the suite deliberately
  // exercises rejected requests, and a diagnostic channel should not turn
  // those assertions into console noise.
  return env.NODE_ENV !== "production" && env.NODE_ENV !== "test";
}

/**
 * Reduces an unknown thrown value to a short, single-line message.
 *
 * The provider's structured `error.message` is preferred over the SDK's
 * composite `Error.message`, which prefixes the status and embeds the whole
 * JSON body — logging that would be logging a raw response body. The fallback
 * is length-capped for the same reason.
 *
 * A 400 message may quote the offending field path, and a field path can
 * echo a fragment of what we sent. That is the entire diagnostic value, and
 * it is why this is opt-in and bounded rather than always on.
 */
export function extractProviderMessage(error: unknown): string | null {
  const raw = readStructuredMessage(error) ?? readErrorMessage(error);
  if (raw === null) return null;

  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;

  // Defence in depth. A provider message has no reason to contain a key, but
  // this channel must never be the thing that puts one in a log.
  const redacted = collapsed.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");

  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}… [truncated]`
    : redacted;
}

/** The provider's own `{ type, message }` body, when the SDK exposes it. */
function readStructuredMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const body = (error as { error?: unknown }).error;
  if (typeof body !== "object" || body === null) return null;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

/**
 * Emits the diagnostic for a rejected request, if enabled.
 *
 * Returns nothing and throws nothing: a diagnostic must never change the
 * outcome of the call it is describing.
 */
export function logRejectedProviderRequest(
  error: unknown,
  diagnostic: ProviderErrorDiagnostic,
  options: {
    env?: Record<string, string | undefined>;
    sink?: ProviderErrorLogSink;
  } = {},
): void {
  const { env = process.env, sink } = options;
  if (!isProviderErrorLoggingEnabled(env)) return;

  const detail: RejectedRequestLogDetail = {
    httpStatus: diagnostic.httpStatus,
    providerErrorType: diagnostic.providerErrorType,
    requestId: diagnostic.requestId,
    providerMessage: extractProviderMessage(error),
  };

  const emit = sink ?? defaultSink;
  try {
    emit("[ai:anthropic] provider rejected request", detail);
  } catch {
    // A broken log sink is not a reason to fail an audit.
  }
}

const defaultSink: ProviderErrorLogSink = (message, detail) => {
  // The process log is the whole point of this module: stderr reaches the
  // Vercel runtime log and nothing else.
  console.error(message, detail);
};

import Anthropic from "@anthropic-ai/sdk";

/**
 * Development-only grammar compile probe (Sprint 4 §9 follow-up).
 *
 * Answers exactly one question: **does this candidate output schema compile
 * into a grammar the provider will accept?** It is not an audit and produces
 * no product data.
 *
 * Why it exists: the provider rejects an oversized grammar with
 * `400 invalid_request_error` before inference, and token counting does *not*
 * compile the grammar, so `countTokens` cannot answer this. The only way to
 * know is to send a real request — so this sends the smallest possible one: a
 * one-character user message, no system prompt, no tools, thinking disabled,
 * and a tiny output ceiling. Grammar compilation is independent of input size,
 * so the answer is identical to a full audit's at a fraction of the cost.
 *
 * **Not free.** A candidate that fails to compile is rejected before inference
 * and is not billed. A candidate that *compiles* runs a real (tiny) inference
 * and is billed for it. Keep successful probes to a minimum.
 *
 * Unreachable from any customer-facing route: nothing under `src/app` imports
 * this, and it is invoked only through `pnpm ai:probe-audit-schema`.
 *
 * This file lives beside the adapter because it imports the provider SDK, and
 * ADR 0011 confines SDK imports to `src/modules/ai/anthropic/`. It returns
 * bounded values only — no message, no response content, ever.
 */

/** Why a probe request failed, as a closed set. Never provider prose. */
export type ProbeFailureCode =
  | "grammar_too_large"
  | "schema_rejected"
  | "request_rejected"
  | "provider_unavailable"
  | "auth_or_billing"
  | "unknown";

export type SchemaProbeResult = {
  compiled: boolean;
  httpStatus: number | null;
  providerErrorType: string | null;
  requestId: string | null;
  failureCode: ProbeFailureCode | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export type SchemaProbeOptions = {
  model: string;
  /** Small deliberately: the probe only needs compilation, not an answer. */
  maxOutputTokens: number;
  apiKey: string;
};

/**
 * Classifies a rejection from the provider's own message *without returning
 * it*. The message is the only place the grammar limit is named, so it is read
 * here and reduced to a code — a bounded value the caller can print safely.
 */
function classifyRejection(message: string, status: number | null): ProbeFailureCode {
  const text = message.toLowerCase();
  if (text.includes("grammar") && (text.includes("too large") || text.includes("too complex"))) {
    return "grammar_too_large";
  }
  if (text.includes("schema") || text.includes("output_config") || text.includes("format")) {
    return "schema_rejected";
  }
  if (status === 401 || status === 403 || status === 402) return "auth_or_billing";
  if (status !== null && status >= 500) return "provider_unavailable";
  if (status !== null && status >= 400) return "request_rejected";
  return "unknown";
}

function readProviderMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = (error as { error?: unknown }).error;
  const direct = readMessage(body);
  if (direct !== null) return direct;
  const nested = readMessage((body as { error?: unknown } | undefined)?.error);
  // Falls back to the composite message *only inside this dev-only classifier*,
  // where it is matched against and then discarded — it is never returned,
  // printed, or logged.
  return nested ?? (typeof error.message === "string" ? error.message : "");
}

function readMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

export async function probeSchemaCompiles(
  schema: Record<string, unknown>,
  options: SchemaProbeOptions,
): Promise<SchemaProbeResult> {
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: 60_000 });
  const startedAt = Date.now();

  try {
    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxOutputTokens,
      // No system prompt, no tools, no effort: the grammar is the only
      // variable under test. Thinking is disabled so the tiny output ceiling
      // is spent on the response rather than on reasoning.
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "x" }],
      output_config: { format: { type: "json_schema", schema } },
    } as Anthropic.MessageCreateParamsNonStreaming);

    return {
      compiled: true,
      httpStatus: 200,
      providerErrorType: null,
      requestId: response._request_id ?? null,
      failureCode: null,
      stopReason: response.stop_reason ?? null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    if (error instanceof Anthropic.APIError) {
      const status = typeof error.status === "number" ? error.status : null;
      return {
        compiled: false,
        httpStatus: status,
        providerErrorType: typeof error.type === "string" ? error.type : null,
        requestId: typeof error.requestID === "string" ? error.requestID : null,
        failureCode: classifyRejection(readProviderMessage(error), status),
        stopReason: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs,
      };
    }

    return {
      compiled: false,
      httpStatus: null,
      providerErrorType: null,
      requestId: null,
      failureCode: "provider_unavailable",
      stopReason: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs,
    };
  }
}

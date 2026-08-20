/**
 * Reading token usage out of a streamed sampling response
 * (EXECUTION CORE-4 runtime placement).
 *
 * ## Why this exists
 *
 * The first real agent run recorded a usage row with `input_tokens: null` and
 * `output_tokens: null`. The gateway was calling `JSON.parse` on the response
 * body, and the Claude Code CLI asks for `stream: true` — so the body was a
 * Server-Sent Event stream, `JSON.parse` threw, and `usageFrom` reported
 * "no tokens known" for a call that had really been billed.
 *
 * That is not only lost accounting. The Agent Gateway measures a run's budget
 * against the tokens in this ledger, so a ceiling fed by zeros is a ceiling
 * that never binds.
 *
 * ## The event contract, verified rather than recalled
 *
 * Checked against the installed `@anthropic-ai/sdk` type declarations
 * (`RawMessageStartEvent`, `RawMessageDeltaEvent`, `MessageDeltaUsage`) and the
 * raw SSE shape in the API reference:
 *
 * ```
 * event: message_start
 * data: {"type":"message_start","message":{"model":"…","usage":{…}}}
 *   └── input_tokens, cache_creation_input_tokens, cache_read_input_tokens
 *       are known here, before a single output token exists.
 *
 * event: message_delta
 * data: {"type":"message_delta","delta":{…},"usage":{"output_tokens":12}}
 *   └── the final, cumulative output count. Its input and cache fields are
 *       typed `number | null` and are null when unchanged, which is why they
 *       are merged over the start event's rather than replacing them.
 *
 * event: message_stop
 *   └── the stream completed. Its absence is what makes a stream *partial*.
 * ```
 *
 * ## What this module refuses to do
 *
 * Read the message content. It parses `usage` and `model` and steps over every
 * other event, so no text, no tool input and no reasoning passes through it —
 * which is what keeps Rule 43 true on a path that sees every token the model
 * produces.
 */

/** What one forwarded sampling call actually cost. */
export type GatewayStreamUsage = {
  /** The model the provider reported serving. Never the one the caller asked for. */
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens, billed inside `outputTokens` (Rule 43: a count, never text). */
  thinkingTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /**
   * Whether the stream reached its end.
   *
   * A partial stream still costs what it produced, so this does not gate
   * recording — it distinguishes "this is the whole bill" from "this is what we
   * saw before the connection died", which are different facts about a run.
   */
  complete: boolean;
  /** A bounded description of an `error` event the provider sent mid-stream. */
  streamError: string | null;
};

const MAX_STREAM_ERROR_CHARS = 200;

/**
 * The most bytes of one SSE line this will hold before giving up on it.
 *
 * A guard against a body that never sends a newline: without it, a hostile or
 * broken upstream could grow this buffer without bound in a process that is
 * also holding an API key.
 */
const MAX_LINE_BYTES = 1024 * 1024;

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/**
 * Reads a usage block, merging over what is already known.
 *
 * `message_delta` reports `input_tokens` and the cache counts as `null` when
 * they have not changed since `message_start`, so a null must leave the earlier
 * value standing. Writing `?? 0` here instead would zero the input tokens of
 * every streamed call — the same class of bug as the one this file fixes.
 */
function mergeUsage(into: GatewayStreamUsage, usage: Record<string, unknown>): void {
  if (typeof usage.input_tokens === "number") into.inputTokens = nonNegativeInt(usage.input_tokens);
  if (typeof usage.output_tokens === "number") {
    into.outputTokens = nonNegativeInt(usage.output_tokens);
  }
  if (typeof usage.cache_read_input_tokens === "number") {
    into.cacheReadInputTokens = nonNegativeInt(usage.cache_read_input_tokens);
  }
  if (typeof usage.cache_creation_input_tokens === "number") {
    into.cacheCreationInputTokens = nonNegativeInt(usage.cache_creation_input_tokens);
  }

  const details = usage.output_tokens_details;
  if (typeof details === "object" && details !== null) {
    const thinking = (details as { thinking_tokens?: unknown }).thinking_tokens;
    if (typeof thinking === "number") into.thinkingTokens = nonNegativeInt(thinking);
  }
}

export type UsageAccumulator = {
  /** Feed one chunk of the response body, in order. Partial lines are held. */
  push(chunk: string): void;
  /** The tally so far. Safe to call at any point, including mid-stream. */
  result(): GatewayStreamUsage;
};

/**
 * Accumulates usage from an SSE body, one chunk at a time.
 *
 * Total by construction: every parse failure is stepped over rather than
 * thrown. This runs beside a response that has already been handed to the
 * caller, and an exception here must never be able to affect it — the agent's
 * turn has to complete whether or not Vibe managed to count it.
 */
export function createUsageAccumulator(): UsageAccumulator {
  const usage: GatewayStreamUsage = {
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    complete: false,
    streamError: null,
  };

  let buffer = "";

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    // `event:` lines carry the same type as the payload's own `type` field, and
    // comments (`:`) and blank separators carry nothing. Only data is read.
    if (!trimmed.startsWith("data:")) return;

    const payload = trimmed.slice("data:".length).trim();
    if (payload.length === 0 || payload === "[DONE]") return;

    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (typeof parsed !== "object" || parsed === null) return;
      event = parsed as Record<string, unknown>;
    } catch {
      // A malformed event is not a reason to lose the events around it.
      return;
    }

    switch (event.type) {
      case "message_start": {
        const message = event.message;
        if (typeof message !== "object" || message === null) return;
        const shaped = message as { model?: unknown; usage?: unknown };
        if (typeof shaped.model === "string") usage.model = shaped.model.slice(0, 128);
        if (typeof shaped.usage === "object" && shaped.usage !== null) {
          mergeUsage(usage, shaped.usage as Record<string, unknown>);
        }
        return;
      }

      case "message_delta": {
        if (typeof event.usage === "object" && event.usage !== null) {
          mergeUsage(usage, event.usage as Record<string, unknown>);
        }
        return;
      }

      case "message_stop": {
        usage.complete = true;
        return;
      }

      case "error": {
        // The provider's own typed error name, never its prose. Enough to tell
        // an overload from a validation failure without storing a message the
        // model or the request influenced.
        const detail = event.error;
        const name =
          typeof detail === "object" && detail !== null
            ? (detail as { type?: unknown }).type
            : undefined;
        usage.streamError =
          typeof name === "string" ? name.slice(0, MAX_STREAM_ERROR_CHARS) : "stream_error";
        return;
      }

      default:
        return;
    }
  };

  return {
    push(chunk: string): void {
      buffer += chunk;

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }

      // An upstream that never sends a newline must not grow this without
      // bound. Dropping the buffer loses one event, which is the smaller harm.
      if (buffer.length > MAX_LINE_BYTES) buffer = "";
    },

    result(): GatewayStreamUsage {
      return { ...usage };
    },
  };
}

/**
 * The same tally, for a response that was not streamed.
 *
 * Kept because the gateway must not assume: the SDK asks for a stream today,
 * and a body that arrives as one JSON object is still a call that was billed.
 */
export function usageFromJsonBody(payload: string): GatewayStreamUsage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as { model?: unknown; usage?: unknown };
  if (typeof message.usage !== "object" || message.usage === null) return null;

  const usage: GatewayStreamUsage = {
    model: typeof message.model === "string" ? message.model.slice(0, 128) : null,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    complete: true,
    streamError: null,
  };

  mergeUsage(usage, message.usage as Record<string, unknown>);
  return usage;
}

/** Whether anything was billed. A call that produced no tokens records none. */
export function hasBilledTokens(usage: GatewayStreamUsage): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadInputTokens > 0 ||
    usage.cacheCreationInputTokens > 0
  );
}

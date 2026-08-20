import { createServer, type Server } from "node:http";

/**
 * A stand-in Anthropic Messages endpoint.
 *
 * ## What it is for
 *
 * Proving that the real Claude Agent SDK routes tool calls through Vibe's
 * policy. That cannot be proved by asserting on the runtime program's text —
 * `allowedTools` bypassed `canUseTool` for a whole paid run while every such
 * assertion passed — so the SDK binary has to actually run.
 *
 * ## What it is not
 *
 * A model. It replays a fixed script of tool calls, in order, and then ends the
 * turn. Nothing here is billed, nothing leaves the machine, and no Anthropic
 * credential is involved: the harness is pointed at `127.0.0.1` through
 * `ANTHROPIC_BASE_URL`, which is the same mechanism production uses to point it
 * at the Vibe gateway.
 */

export type ScriptedToolCall = {
  /** The SDK tool name, e.g. "Bash" or "Read". */
  name: string;
  /** The tool's arguments, exactly as the model would have produced them. */
  input: Record<string, unknown>;
};

export type StubAnthropic = {
  readonly url: string;
  /** How many message requests the SDK made. */
  readonly requests: number;
  close(): Promise<void>;
};

function sse(events: [string, unknown][]): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function message(id: string) {
  return {
    id,
    type: "message",
    role: "assistant",
    model: "canary-stub",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 },
  };
}

function toolUseTurn(id: string, call: ScriptedToolCall): string {
  return sse([
    ["message_start", { type: "message_start", message: message(id) }],
    [
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: `toolu_${id}`, name: call.name, input: {} },
      },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 10 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ]);
}

function finalTurn(id: string): string {
  return sse([
    ["message_start", { type: "message_start", message: message(id) }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ]);
}

/** Starts the stub on an ephemeral port and replays `script`, one call per turn. */
export async function startStubAnthropic(script: readonly ScriptedToolCall[]): Promise<StubAnthropic> {
  let requests = 0;

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!req.url?.includes("/v1/messages")) {
        res.writeHead(404, { "content-type": "application/json" }).end("{}");
        return;
      }

      const index = requests;
      requests += 1;

      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(index < script.length ? toolUseTurn(`m${index}`, script[index]) : finalTurn(`m${index}`));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return requests;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

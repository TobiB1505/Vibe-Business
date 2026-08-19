import "server-only";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSdkMcpServer,
  query,
  tool,
  type Options,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentModelUsage,
  CodingAgentProvider,
  CodingAgentRequest,
  CodingAgentResult,
} from "../provider";
import type { AgentProviderOutcome } from "../schema";
import { AGENT_TOOL_SHAPES } from "./tools";

/**
 * The Claude coding-agent adapter (EXECUTION CORE-4 §5, §6, §7, §11, §19, §38).
 *
 * **The only file in the codebase that imports `@anthropic-ai/claude-agent-sdk`.**
 * Everything above it speaks `CodingAgentProvider`, so the gateway — where every
 * security decision lives — is tested against a fake, and the SDK's vocabulary
 * never reaches the execution domain (CLAUDE.md rule 21).
 *
 * Checked against the installed SDK's own type declarations at implementation
 * time rather than recalled. Four of its defaults are load-bearing here and
 * three of them are actively wrong for this use case.
 *
 * ## Why nothing in production constructs this any more
 *
 * The harness it describes cannot start here. `query()` spawns a native `claude`
 * binary of 307–325 MB depending on platform, and a Vercel function's whole
 * deployment budget is 250 MB — which the first real dogfood discovered by
 * failing in 44 ms having taken zero turns. The runtime therefore moved into the
 * execution's own microVM (`sandbox-runtime/`), and the SDK moved to a
 * devDependency so that 325 MB never enters a deployed function again.
 *
 * This file is kept rather than deleted because the topology it documents is
 * still the one the `gateway_tools` runtime describes, and because a build that
 * re-wires it into production will now fail loudly on the missing dependency
 * instead of deploying and dying at run time.
 *
 * ## The topology, and why it is this one (§7)
 *
 * ```
 *  Vibe server process                 TRUSTED
 *  ├── this adapter
 *  ├── Claude Agent SDK  ──spawns──▶  Claude Code CLI subprocess   TRUSTED
 *  │                                  (holds the Anthropic key; has NO tools)
 *  └── in-process MCP tool server ──▶ ExecutionToolGateway
 *                                          │
 *                                          ▼
 *                                     Sandbox VM                  UNTRUSTED
 *                                     (the customer's repository)
 * ```
 *
 * The SDK's normal shape is the opposite of what this needs: a batteries-
 * included coding agent with `Read`, `Write`, `Edit`, `Bash`, `Glob` and `Grep`
 * operating on the local filesystem. That would run an agent with filesystem
 * and shell access **on Vibe's own machine**, which is precisely the remote
 * code execution vulnerability `validation/sandbox-port.ts` refuses in its own
 * domain.
 *
 * So the built-in tool set is emptied (`tools: []`) and the only tools that
 * exist are in-process MCP tools whose handlers call the gateway. The handlers
 * run **inside the Vibe process**, not in the sandbox — so the Anthropic
 * credential and the tool policy stay on the trusted side of the line, and the
 * customer's code never shares an address space with either.
 *
 * ## The four defaults
 *
 * - **`tools` defaults to the Claude Code preset.** Forced to `[]`. Nothing
 *   else in this file would matter if a `Bash` tool existed.
 * - **`env` defaults to inheriting `process.env`.** Replaced with an explicit
 *   minimal set. Inheriting would put the Supabase service-role key, the GitHub
 *   App private key and the Stripe secret into the subprocess environment for
 *   no reason at all (§13).
 * - **`settingSources` defaults to loading none**, and it is passed explicitly
 *   anyway: a future default change must not silently start reading a
 *   `CLAUDE.md` or a `.claude/settings.json` from disk. Repository-authored
 *   instructions are untrusted data, never configuration (Rule 25, §51).
 * - **`persistSession` defaults to writing the transcript to disk.** Forced
 *   off. That file would be a durable record of model reasoning and customer
 *   source, which Rule 43 and §24 both forbid keeping.
 *
 * ## Permissions are enforced twice, deliberately
 *
 * `canUseTool` refuses anything that is not one of the tools this run offered,
 * and the gateway refuses again inside the handler. The first is a courtesy to
 * the harness — it keeps a denial cheap and legible in `permission_denials` —
 * and the second is the control. A policy enforced in only one layer is a
 * policy a provider swap silently drops.
 */

/**
 * The subprocess environment, in full (§7, §13).
 *
 * An allowlist rather than a denylist. A denylist has to enumerate every secret
 * this application will ever hold, and gets it wrong the first time somebody
 * adds one.
 *
 * `ANTHROPIC_API_KEY` is here because the subprocess is the thing making the
 * inference call — it is inside the trusted boundary, and no customer code runs
 * there. The rest is what a Node process needs to start and to make an HTTPS
 * request through a corporate proxy or a custom CA. Nothing else is inherited.
 */
const INHERITED_ENV_KEYS: readonly string[] = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "NODE_EXTRA_CA_CERTS",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
];

export function agentSubprocessEnv(
  source: Record<string, string | undefined> = process.env,
  options: { configDir?: string } = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of INHERITED_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  // Identifies this integration in the provider's User-Agent. Not a credential.
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "vibe-business-execution/1";
  // Belt and braces: the harness has no tools that could read a file anyway,
  // but an explicit non-interactive marker keeps a future default honest.
  env.CI = "1";

  /*
   * Auto memory loads *regardless* of `settingSources` (Anthropic, "Hosting
   * the Agent SDK" → Multi-tenant isolation).
   *
   * That is the whole reason this line exists. `settingSources: []` is already
   * passed, and reading it as "no filesystem input reaches the system prompt"
   * is wrong: `~/.claude/projects/<project>/memory/` is loaded on top of it.
   * For a harness that runs one customer's work after another's, that is a
   * documented path for one tenant's context to become another tenant's
   * instructions — and Rule 25 says repository-derived content is data, never
   * instructions.
   */
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";

  /*
   * A per-run config directory, so runs never share `~/.claude.json`.
   *
   * The same source recommends it for multi-tenant isolation. Omitted rather
   * than defaulted when the caller has no directory to give: pointing every run
   * at one invented path would be the shared-state problem with extra steps.
   */
  if (options.configDir) env.CLAUDE_CONFIG_DIR = options.configDir;

  return env;
}

const SERVER_NAME = "vibe";

/** MCP tools are addressed as `mcp__<server>__<tool>` once the SDK loads them. */
function qualified(name: string): string {
  return `mcp__${SERVER_NAME}__${name}`;
}

function unqualified(name: string): string {
  const prefix = `mcp__${SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * A safe description of a thrown provider value.
 *
 * Never serialize the object. An SDK error can carry request context, headers
 * and occasionally a credential; only the name and a bounded message are kept,
 * for the reason ADR 0015 §9 records — a generic constant is what turns a
 * diagnosable failure into four wasted runs.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, " ").trim().slice(0, 400);
    return message.length > 0 ? `${error.name}: ${message}` : error.name;
  }
  return "the agent provider threw a non-error value";
}

function toModelUsage(modelUsage: Record<string, unknown>): AgentModelUsage[] {
  const usage: AgentModelUsage[] = [];

  for (const [model, raw] of Object.entries(modelUsage)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const number = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

    usage.push({
      model,
      inputTokens: number(entry.inputTokens),
      outputTokens: number(entry.outputTokens),
      cacheReadInputTokens: number(entry.cacheReadInputTokens),
      cacheCreationInputTokens: number(entry.cacheCreationInputTokens),
      // Carried, never trusted as the billing figure. The SDK's own type
      // documentation calls it "an estimate, not a billing statement", which is
      // exactly what §19 warns against using as authority.
      reportedCostUsd:
        typeof entry.costUSD === "number" && Number.isFinite(entry.costUSD) ? entry.costUSD : null,
    });
  }

  return usage;
}

function outcomeFor(subtype: string): AgentProviderOutcome {
  switch (subtype) {
    case "success":
      return "completed";
    case "error_max_turns":
      return "max_turns";
    case "error_max_budget_usd":
      return "max_cost";
    default:
      return "provider_error";
  }
}

export function createClaudeCodingAgentProvider(): CodingAgentProvider {
  return {
    id: "anthropic",
    harness: "claude_agent_sdk",

    async run(request: CodingAgentRequest): Promise<CodingAgentResult> {
      const startedAt = Date.now();

      // Vibe's own abort controller, so a gateway halt, a wall-clock ceiling and
      // a caller cancellation all stop the run through one mechanism (§36).
      const controller = new AbortController();
      const stopOnCallerAbort = () => controller.abort();
      request.signal.addEventListener("abort", stopOnCallerAbort, { once: true });

      /**
       * Set by a tool handler that received `halt`.
       *
       * Aborting *inside* the handler would race the SDK's delivery of the tool
       * result, so the flag is read after each message instead: the model sees
       * why it was stopped, and then the run ends deterministically.
       */
      let haltRequested = false;
      const offeredNames = new Set(request.tools.map((descriptor) => qualified(descriptor.name)));

      const tools = request.tools
        .map((descriptor) => {
          const shape = AGENT_TOOL_SHAPES[descriptor.name];
          if (!shape) return null;

          return tool(descriptor.name, descriptor.description, shape, async (args) => {
            const outcome = await request.invokeTool(descriptor.name, args as Record<string, unknown>);

            if (outcome.kind === "halt") haltRequested = true;

            const text =
              outcome.kind === "ok"
                ? outcome.content
                : outcome.kind === "denied"
                  ? `Denied (${outcome.reason}): ${outcome.message}`
                  : outcome.message;

            return {
              content: [{ type: "text" as const, text }],
              // A denial is an ordinary, expected event the model should route
              // around — not an error that ends the turn (§11).
              ...(outcome.kind === "halt" ? { isError: true } : {}),
            };
          });
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      // With `tools: []` there is no filesystem tool, so the working directory
      // is inert — and it is still an empty scratch directory rather than the
      // server's cwd, because "inert today" is not a property to depend on.
      const workdir = await mkdtemp(join(tmpdir(), "vibe-agent-"));

      const options: Options = {
        // No built-in tools. Not restricted — absent.
        tools: [],
        mcpServers: {
          [SERVER_NAME]: createSdkMcpServer({
            name: SERVER_NAME,
            version: "1.0.0",
            tools,
          }),
        },
        // Ignore any `.mcp.json`, user settings or plugin-provided server on
        // disk. The tool surface is exactly the one compiled above.
        strictMcpConfig: true,
        settingSources: [],
        systemPrompt: request.instruction.system,
        model: request.model,
        effort: request.effort,
        maxTurns: request.limits.maxTurns,
        maxBudgetUsd: request.limits.maxProviderSpendUsd,
        permissionMode: "default",
        allowDangerouslySkipPermissions: false,
        canUseTool: async (toolName): Promise<PermissionResult> =>
          offeredNames.has(toolName)
            ? { behavior: "allow" }
            : {
                behavior: "deny",
                message: "That tool is not available to this execution.",
                interrupt: false,
              },
        cwd: workdir,
        // The run's own scratch directory doubles as its config directory, so
        // two runs never read each other's global config.
        env: agentSubprocessEnv(process.env, { configDir: join(workdir, ".claude") }),
        // No transcript on disk: it would be a durable record of model
        // reasoning and customer source (Rule 43, §24).
        persistSession: false,
        includePartialMessages: false,
        abortController: controller,
      };

      /*
       * Two counters, in two units, never one that switches.
       *
       * `assistantMessages` is one per model response. `sdkLoopIterations` is
       * the harness's own `num_turns`, which advances on tool results as well —
       * so it is the unit `maxTurns` bounds. This used to be a single variable
       * that counted messages and was then overwritten by `num_turns`, which is
       * how run b33635a1 came to report 66 against a ceiling of 40 while
       * overrunning nothing.
       */
      let assistantMessages = 0;
      let sdkLoopIterations: number | null = null;
      let usage: readonly AgentModelUsage[] = [];
      let sessionId: string | null = null;
      let providerDeniedToolCalls = 0;
      let outcome: AgentProviderOutcome = "provider_error";
      let failureDetail: string | null = null;

      try {
        for await (const message of query({
          prompt: request.instruction.userMessage,
          options,
        }) as AsyncIterable<SDKMessage>) {
          if (message.type === "assistant") assistantMessages += 1;

          if (message.type === "system" && message.subtype === "permission_denied") {
            providerDeniedToolCalls += 1;
          }

          if (message.type === "result") {
            // Cumulative per the SDK's contract — read the latest result rather
            // than summing across them.
            usage = toModelUsage(message.modelUsage as Record<string, unknown>);
            sessionId = message.session_id;
            sdkLoopIterations = message.num_turns;
            providerDeniedToolCalls = message.permission_denials.length;
            outcome = outcomeFor(message.subtype);
            if (message.subtype !== "success") {
              failureDetail = `agent run ended: ${message.subtype}`;
            }
            break;
          }

          if (haltRequested) {
            // The gateway stopped this run — cancelled, paused on a question, or
            // out of budget. Abort rather than let the model take another turn.
            outcome = "aborted";
            controller.abort();
            break;
          }
        }

        // Aborted before any result message: the loop above broke on a halt, or
        // the caller cancelled. Either way the provider reported nothing.
        if (controller.signal.aborted && outcome === "provider_error") outcome = "aborted";
      } catch (error) {
        // §37: an ambiguous paid outcome must never be resolved optimistically.
        // Whatever usage the provider had already reported is kept, and the
        // caller decides — from durable state — whether continuing is safe.
        outcome = controller.signal.aborted ? "aborted" : "provider_error";
        failureDetail = describeError(error);
      } finally {
        request.signal.removeEventListener("abort", stopOnCallerAbort);
        // Best effort. A leftover empty scratch directory is not worth failing
        // a run that otherwise succeeded.
        await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
      }

      return {
        outcome,
        assistantMessages,
        sdkLoopIterations,
        /*
         * The in-process adapter brokers every tool through the gateway and
         * hosts no shell of its own, so it makes no verification decisions.
         * Null, never zero — zero would claim it decided nothing was needed.
         */
        verificationCommands: null,
        verificationRefusals: null,
        usage,
        // An opaque identifier, not a reconnect credential: the SDK's resume
        // path needs the on-disk transcript, which `persistSession: false`
        // never wrote. Kept only so a support question about one run can be
        // joined to the provider's own records (§38).
        sessionId,
        providerDeniedToolCalls,
        durationMs: Date.now() - startedAt,
        failureDetail,
      };
    },
  };
}

export { unqualified as unqualifiedToolName };

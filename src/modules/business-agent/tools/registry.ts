import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIToolDescriptor } from "@/modules/ai/provider";
import type { AgentArtifactRef } from "../artifacts";
import {
  AGENT_TOOL_NAMES,
  type AgentToolClassification,
  type AgentToolName,
} from "../catalog";
import { AGENT_TURN_BUDGETS } from "../orchestrator/budgets";
import { getBusinessHealthTool } from "./health";
import { getProjectFocusTool } from "./focus";
import { getOpportunitiesTool } from "./opportunities";
import { getActionPlanTool } from "./plan";
import { resolveExecutionTool } from "./execution";
import { useSkillTool } from "./skills";

/**
 * The Business Agent's closed tool set (ADR 0109, rule 41, rule 76).
 *
 * ## Absent capability, not denied capability
 *
 * `AGENT_TOOLS` is a total `Record` over `AGENT_TOOL_NAMES`. A name outside it
 * does not resolve to a denial handler that could be misconfigured — it
 * resolves to nothing, and the loop answers the model with `unknown_tool`.
 * Nothing here writes to a repository, starts a paid operation, approves,
 * merges, deploys, moves money, opens a connection to a URL, runs a command,
 * composes SQL, or names a model. There is no flag that would turn any of
 * those on, because none of them is written.
 *
 * ## Six tools, because six answer the question
 *
 * Rule 15. The audit's catalogue names twenty; this slice answers one question
 * and the tools it needs are the tools that exist. `get_project_context` was
 * considered and left out: the context brief already carries the product's
 * identity, so a tool for it would only ever be called to re-read something the
 * model was handed.
 *
 * ## No sentinel arguments
 *
 * The seam pilot measured what a sentinel costs: asked to pass `""` for "the
 * latest plan", the model emitted `"\""\""`, a space, and fragments of its own
 * tool-call markup, then repeated the malformed call until the ceiling stopped
 * the turn with nothing said to the founder (ADR 0109). Every argument here is
 * a required, real identifier the model read out of an earlier tool result.
 * Where an identifier cannot be resolved, the tool returns a typed state that
 * names the way back — never a second guess.
 *
 * ## Arguments carry no authority (rule 53)
 *
 * `projectId` and `userId` come from the persisted operation row and are never
 * arguments. Every identifier the model supplies is looked up inside this
 * project's own rows: a Move id from another project is `not_found`, which is
 * the same answer a malformed one gets, and neither reaches a row. No adapter
 * calls a store function that lacks a project predicate — `getActionPlanById`
 * and `getProfileById` are both unscoped and both deliberately unused here.
 */

/**
 * Re-exported so a tool adapter has one import, while the names, their
 * classifications and the words a founder reads live in `../catalog.ts` —
 * which carries no `server-only` and so can be read by the thread.
 */
export {
  AGENT_TOOL_NAMES,
  AGENT_TOOL_CLASSIFICATION,
  AGENT_TOOL_PROGRESS_LABELS,
  isAgentToolName,
  type AgentToolName,
  type AgentToolClassification,
} from "../catalog";

export const AGENT_TOOL_ERROR_CODES = [
  /** The identifier is not one of this project's rows, or is malformed. */
  "not_found",
  /** The row exists but nothing has produced the thing being asked for yet. */
  "unavailable",
  /** The read failed. Said plainly rather than dressed as an empty answer. */
  "read_failed",
] as const;

export type AgentToolErrorCode = (typeof AGENT_TOOL_ERROR_CODES)[number];

/**
 * Re-exported so a tool adapter has one import, while the kinds themselves live
 * in `../artifacts.ts` — which carries no `server-only` and so can be read by
 * the block registry the thread renders through.
 */
export { AGENT_ARTIFACT_KINDS, type AgentArtifactKind, type AgentArtifactRef } from "../artifacts";

export type AgentToolOutcome =
  | {
      kind: "ok";
      /** The bounded text the model reads. Never a row, never a document. */
      content: string;
      /** Ids this result carried, so the validator can refuse a reference to anything else. */
      subjectIds: readonly string[];
      /** Numerals this result carried, so the validator can refuse an invented figure. */
      artifacts: readonly AgentArtifactRef[];
    }
  | { kind: "error"; code: AgentToolErrorCode; message: string };

export type AgentToolContext = {
  supabase: SupabaseClient;
  /** From the operation row. Never from the model. */
  projectId: string;
  /** From the operation row. Some reads load a repository connection as its owner. */
  userId: string;
};

export type AgentTool = {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  classification: AgentToolClassification;
  /*
   * No `progressLabel` here on purpose. The words a founder reads while a step
   * runs live in `../catalog.ts`, because the thread renders them in the
   * browser and this file is `server-only`. One source, read from both sides.
   */
  execute(context: AgentToolContext, input: Record<string, unknown>): Promise<AgentToolOutcome>;
};

type PropertySchema =
  | { type: "string"; enum?: readonly string[]; description?: string }
  | { type: "boolean"; description?: string };

/** A strict-subset object schema: every property required, no extras. */
export function strictObject(properties: Record<string, PropertySchema>): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export type ArgumentValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Hand-rolled, because the subset is small and a schema library would be a
 * dependency decision (rule 3). Supports exactly what these tools declare:
 * flat objects of strings, optionally enum-constrained.
 *
 * It runs on every call on both the provider's strict path and Vibe's own,
 * because a schema the model was shown is a request and a check the runtime
 * performs is a fact.
 */
export function validateArguments(
  schema: Record<string, unknown>,
  input: unknown,
): ArgumentValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "arguments must be an object" };
  }
  const properties = (schema.properties ?? {}) as Record<string, PropertySchema>;
  const required = (schema.required ?? []) as readonly string[];
  const value = input as Record<string, unknown>;

  for (const key of Object.keys(value)) {
    if (!(key in properties)) return { ok: false, reason: `unexpected argument "${key}"` };
  }
  for (const key of required) {
    if (!(key in value)) return { ok: false, reason: `missing argument "${key}"` };
  }
  for (const [key, property] of Object.entries(properties)) {
    const given = value[key];
    if (property.type === "string") {
      if (typeof given !== "string") return { ok: false, reason: `"${key}" must be a string` };
      if (property.enum && !property.enum.includes(given)) {
        return { ok: false, reason: `"${key}" must be one of ${property.enum.join(", ")}` };
      }
    } else if (typeof given !== "boolean") {
      return { ok: false, reason: `"${key}" must be true or false` };
    }
  }
  return { ok: true, value };
}

/**
 * Cuts a rendered result to the byte ceiling and says so in the text.
 *
 * Truncation is announced rather than silent: a model that cannot tell a short
 * list from a cut one will describe the cut one as complete, and a founder will
 * read that as the whole answer.
 */
export function boundToolResult(
  content: string,
  maxBytes: number = AGENT_TURN_BUDGETS.maxToolResultBytes,
): string {
  const encoded = Buffer.from(content, "utf8");
  if (encoded.byteLength <= maxBytes) return content;
  const notice = "\n[cut to fit — this result is incomplete]";
  const room = maxBytes - Buffer.byteLength(notice, "utf8");
  return `${encoded.subarray(0, Math.max(0, room)).toString("utf8")}${notice}`;
}

export const AGENT_TOOLS: Record<AgentToolName, AgentTool> = {
  use_skill: useSkillTool,
  get_project_focus: getProjectFocusTool,
  get_business_health: getBusinessHealthTool,
  get_opportunities: getOpportunitiesTool,
  get_action_plan: getActionPlanTool,
  resolve_execution: resolveExecutionTool,
};

export const TOOL_REGISTRY_VERSION = "agent-tools-v1";

/** What the provider is told the model may call. Order is the registry's. */
export function agentToolDescriptors(): readonly AIToolDescriptor[] {
  return AGENT_TOOL_NAMES.map((name) => ({
    name,
    description: AGENT_TOOLS[name].description,
    inputSchema: AGENT_TOOLS[name].inputSchema,
  }));
}

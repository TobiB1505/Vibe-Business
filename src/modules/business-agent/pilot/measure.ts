import { measureSchema, type SchemaMetrics } from "@/modules/ai/probe/schema-metrics";
import { PILOT_CASES, type PilotCase } from "./cases";
import { baseEnvironment } from "./fixtures";
import {
  buildPilotSystemPrompt,
  renderContextBrief,
  renderFounderMessage,
  renderToolResult,
} from "./prompt";
import { PILOT_ACTION_SCHEMA } from "./seam-b";
import { PILOT_TOOLS, pilotToolDescriptors, type PilotToolName } from "./tools";

/**
 * What can be measured about the two seams without a provider call.
 *
 * Three things decide most of the economics before any model runs, and all
 * three are properties of request *shape*: how many bytes a tool contract
 * costs to declare, how much of each request is re-sent verbatim, and how
 * large the structured schema the grammar compiler must accept is. These
 * are counted here from the real prompt, the real descriptors and the real
 * fixture — the same objects the paid run sends — so the ADR can quote a
 * number that a reader can re-derive by running `measure.test.ts`.
 *
 * Bytes, not tokens: a token count needs the provider's tokenizer, and the
 * free `countInputTokens` call is the only honest source of one. The byte
 * ratio between the seams is what matters, and it survives tokenisation.
 */

export type ShapeMeasurement = {
  seamA: {
    systemPromptBytes: number;
    toolDescriptorBytes: number;
    /** Per-request bytes that never change between calls of one turn and can sit under a cache breakpoint. */
    stablePrefixBytes: number;
  };
  seamB: {
    systemPromptBytes: number;
    actionSchema: SchemaMetrics;
    /** The structured path has no field a tool contract could ride on. */
    toolDescriptorBytes: 0;
    stablePrefixBytes: number;
  };
  /** For one representative three-tool trajectory: bytes sent per model call, cumulative. */
  representativeTurn: {
    tools: readonly PilotToolName[];
    seamA: { perCallBytes: number[]; totalBytes: number; uncachedBytesIfPrefixCached: number };
    seamB: { perCallBytes: number[]; totalBytes: number; uncachedBytesIfPrefixCached: number };
  };
};

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/** The turn most cases take: focus, health, moves, then an answer. */
const REPRESENTATIVE: readonly PilotToolName[] = [
  "get_project_focus",
  "get_business_health",
  "get_opportunities",
];

export function measurePilotShapes(pilotCase: PilotCase = PILOT_CASES[0]): ShapeMeasurement {
  const environment = baseEnvironment();
  const systemA = buildPilotSystemPrompt("A");
  const systemB = buildPilotSystemPrompt("B");
  const descriptors = JSON.stringify(pilotToolDescriptors());
  const head = `${renderContextBrief(environment)}\n\n${renderFounderMessage(pilotCase.founderMessage)}`;

  const results = REPRESENTATIVE.map((name) => {
    const args = name === "get_business_health" ? { lens: "all" } : {};
    return renderToolResult(name, PILOT_TOOLS[name].execute(environment, args));
  });

  // Seam A: the transcript grows by one assistant tool_use block and one
  // tool_results block per call; everything before the last message is a
  // stable prefix the provider can cache.
  const seamAPerCall: number[] = [];
  let transcriptA = head;
  for (let call = 0; call <= results.length; call += 1) {
    seamAPerCall.push(bytes(systemA) + bytes(descriptors) + bytes(transcriptA));
    if (call < results.length) {
      transcriptA += `\n${JSON.stringify({ tool_use: REPRESENTATIVE[call] })}\n${results[call]}`;
    }
  }

  // Seam B: one user string, rebuilt and re-sent in full; the system prompt
  // and the schema are the only stable prefix.
  const seamBPerCall: number[] = [];
  const schemaB = JSON.stringify(PILOT_ACTION_SCHEMA);
  let transcriptB = head;
  for (let call = 0; call <= results.length; call += 1) {
    seamBPerCall.push(bytes(systemB) + bytes(schemaB) + bytes(transcriptB));
    if (call < results.length) {
      transcriptB += `\n\nACTION ${call + 1}: call_tool ${REPRESENTATIVE[call]} {}\nRESULT:\n${results[call]}`;
    }
  }

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const stableA = bytes(systemA) + bytes(descriptors);
  const stableB = bytes(systemB) + bytes(schemaB);

  return {
    seamA: {
      systemPromptBytes: bytes(systemA),
      toolDescriptorBytes: bytes(descriptors),
      stablePrefixBytes: stableA,
    },
    seamB: {
      systemPromptBytes: bytes(systemB),
      actionSchema: measureSchema(PILOT_ACTION_SCHEMA),
      toolDescriptorBytes: 0,
      stablePrefixBytes: stableB,
    },
    representativeTurn: {
      tools: REPRESENTATIVE,
      seamA: {
        perCallBytes: seamAPerCall,
        totalBytes: sum(seamAPerCall),
        // With a prefix cache, only what grew since the previous call is new
        // on Seam A; on Seam B the whole user string is new every call.
        uncachedBytesIfPrefixCached:
          seamAPerCall[0] +
          sum(seamAPerCall.slice(1).map((value, index) => value - seamAPerCall[index])),
      },
      seamB: {
        perCallBytes: seamBPerCall,
        totalBytes: sum(seamBPerCall),
        uncachedBytesIfPrefixCached: sum(seamBPerCall.map((value) => value - stableB)) + stableB,
      },
    },
  };
}

export function formatShapeMeasurement(measurement: ShapeMeasurement): string {
  const { seamA, seamB, representativeTurn: turn } = measurement;
  return [
    `Seam A  system=${seamA.systemPromptBytes}B  tools=${seamA.toolDescriptorBytes}B  stable prefix=${seamA.stablePrefixBytes}B`,
    `Seam B  system=${seamB.systemPromptBytes}B  schema=${seamB.actionSchema.byteSize}B (objects=${seamB.actionSchema.objectCount}, enums=${seamB.actionSchema.enumCount}/${seamB.actionSchema.enumMemberCount} members, depth=${seamB.actionSchema.maxDepth})  stable prefix=${seamB.stablePrefixBytes}B`,
    `Representative turn (${turn.tools.join(" → ")} → answer), bytes per call:`,
    `  A: ${turn.seamA.perCallBytes.join(" / ")}  total=${turn.seamA.totalBytes}  new-if-cached=${turn.seamA.uncachedBytesIfPrefixCached}`,
    `  B: ${turn.seamB.perCallBytes.join(" / ")}  total=${turn.seamB.totalBytes}  new-if-cached=${turn.seamB.uncachedBytesIfPrefixCached}`,
  ].join("\n");
}

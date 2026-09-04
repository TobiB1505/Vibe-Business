import { beforeEach, describe, expect, it } from "vitest";

import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { AIProvider, StructuredRequest, StructuredResult } from "@/modules/ai/provider";
import { readNovaMoveVoice } from "@/modules/nova/voice/move-slot";

import { FakeDatabase, fakeSupabase } from "../test-support";
import type { ExecutionDeps } from "../business-audit/execution";
import { completeOpportunityOperationStep } from "./execution";

/**
 * The test that was missing, and the bug it would have caught.
 *
 * `move_recommendation` shipped and generated nothing on its first live run.
 * Not a provider failure and not a switch: `getOpportunitySetById` does not
 * join the Moves, `mapSet` defaults `opportunities` to `[]`, and the trigger
 * read an empty set and returned early — silently, with the operation
 * reporting success.
 *
 * Every unit test passed, because they all called `topMove` with an array
 * somebody had already built. Nothing exercised the read. So this drives the
 * real completion step against a real store read, and the seam it covers is
 * exactly the one a fixture cannot: whether the data actually arrives.
 */

const USER = "44444444-4444-4444-8444-444444444444";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OPERATION = "33333333-3333-4333-8333-333333333333";
const SET = "55555555-5555-4555-8555-555555555555";

const SPOKEN = "Getting paid is the thing standing in the way, and the plumbing is already there.";

let db: FakeDatabase;
let generated: number;

function provider(): AIProvider {
  return {
    name: "anthropic",
    countInputTokens: async () => ({ ok: true, inputTokens: 500 }),
    generateStructured: async (request: StructuredRequest): Promise<StructuredResult> => {
      generated += 1;
      return {
        ok: true,
        data: { message: request.operation === "nova_presentation" ? SPOKEN : "wrong operation" },
        usage: { inputTokens: 500, outputTokens: 40, thinkingTokens: 0 },
        model: NOVA_PRESENTATION_CONFIG.model,
        latencyMs: 900,
      };
    },
  };
}

function deps(): ExecutionDeps {
  return { supabase: fakeSupabase(db), provider: provider() };
}

/** A completed set with its Moves in the table they actually live in. */
function seedSetWithMoves(moveCount = 2) {
  db.seed("projects", { id: PROJECT, user_id: USER });
  db.seed("opportunity_sets", {
    id: SET,
    project_id: PROJECT,
    business_audit_id: "66666666-6666-4666-8666-666666666666",
    input_hash: "a".repeat(64),
    status: "completed",
    opportunity_count: moveCount,
    validation_notes: [],
    failure_code: null,
    engine_version: "v1",
    prompt_version: "v1",
    rubric_version: "v1",
    evidence_pack_version: "v1",
    provider: "anthropic",
    model: NOVA_PRESENTATION_CONFIG.model,
    created_at: "2026-09-04T02:00:00.000Z",
    completed_at: "2026-09-04T02:01:00.000Z",
  });

  /* Seeded out of rank order, so a trigger that took the first row rather than
     the lowest rank would show it. */
  for (const rank of [...Array(moveCount).keys()].map((index) => moveCount - index)) {
    db.seed("business_opportunities", {
      id: `move_${rank}`,
      opportunity_set_id: SET,
      rank,
      source_conclusion_key: null,
      title: rank === 1 ? "Make pricing and checkout reachable" : `Move number ${rank}`,
      problem: rank === 1 ? "Nobody can find a price or complete a purchase." : "Something else.",
      why_now: rank === 1 ? "It sits in front of every other improvement." : "Later.",
      impact: "high",
      effort: "medium",
      confidence: "high",
      category: "conversion",
      primary_lens: "conversion",
      secondary_lenses: [],
      evidence_ids: [],
      execution_type: null,
      execution_readiness: null,
      dependencies: [],
    });
  }

  db.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "opportunity_generation",
    status: "running",
    stage: "persisting",
    input_identity: "b".repeat(64),
    result_id: null,
    failure_code: null,
    started_at: "2026-09-04T02:00:00.000Z",
    completed_at: null,
    created_at: "2026-09-04T02:00:00.000Z",
    pause_cycle: 0,
  });
}

function voiceRows() {
  return db.rows("nova_voice_messages") as unknown as { slot: string; message: string | null }[];
}

function novaUsage() {
  return (db.rows("ai_usage_events") as unknown as { operation: string; job_id: string }[]).filter(
    (row) => row.operation === "nova_presentation",
  );
}

beforeEach(() => {
  db = new FakeDatabase();
  generated = 0;
  process.env.NOVA_VOICE_ENABLED = "1";
  seedSetWithMoves();
});

describe("the Moves actually reach Nova", () => {
  /** The regression. It failed against the un-joined read. */
  it("generates a message about the top-ranked Move", async () => {
    await completeOpportunityOperationStep(deps(), OPERATION, SET);

    expect(generated).toBe(1);
    expect(voiceRows()).toHaveLength(1);
    expect(voiceRows()[0]).toMatchObject({ slot: "move_recommendation", message: SPOKEN });
  });

  it("records the spend against the existing ledger", async () => {
    await completeOpportunityOperationStep(deps(), OPERATION, SET);

    expect(novaUsage()).toHaveLength(1);
    expect(novaUsage()[0].job_id).toBe(OPERATION);
  });

  /** A component reading the same set resolves the stored sentence. */
  it("is readable afterwards through the render path", async () => {
    await completeOpportunityOperationStep(deps(), OPERATION, SET);

    const { getOpportunitySetWithMoves } = await import("@/modules/opportunities/store");
    const stored = await getOpportunitySetWithMoves(fakeSupabase(db), SET);
    const move = stored?.opportunities.find((candidate) => candidate.rank === 1);
    if (!move) throw new Error("the seeded set must have a rank-1 Move");

    const read = await readNovaMoveVoice(fakeSupabase(db), {
      projectId: PROJECT,
      move,
      primaryGoal: null,
    });

    expect(read).toMatchObject({ message: SPOKEN, source: "voice", resolved: true });
  });

  /** The set is loaded by rank, not by insertion order. */
  it("speaks about rank 1 even when it was written last", async () => {
    const { getOpportunitySetWithMoves } = await import("@/modules/opportunities/store");
    const stored = await getOpportunitySetWithMoves(fakeSupabase(db), SET);

    expect(stored?.opportunities.map((move) => move.rank)).toEqual([1, 2]);
  });
});

describe("the operation does not depend on Nova", () => {
  it("completes when the set has no Moves at all", async () => {
    db = new FakeDatabase();
    generated = 0;
    seedSetWithMoves(0);

    await completeOpportunityOperationStep(deps(), OPERATION, SET);

    const operation = db.rows("operation_runs")[0] as unknown as { status: string };
    expect(operation.status).toBe("completed");
    expect(voiceRows()).toEqual([]);
    expect(generated).toBe(0);
  });

  it("completes when the voice model throws", async () => {
    await completeOpportunityOperationStep(
      {
        supabase: fakeSupabase(db),
        provider: {
          ...provider(),
          generateStructured: async () => {
            throw new Error("socket hang up");
          },
        },
      },
      OPERATION,
      SET,
    );

    const operation = db.rows("operation_runs")[0] as unknown as { status: string };
    expect(operation.status).toBe("completed");
  });

  /** Replay: the transitioned guard means one presentation per operation. */
  it("generates nothing on a replayed completion", async () => {
    await completeOpportunityOperationStep(deps(), OPERATION, SET);
    await completeOpportunityOperationStep(deps(), OPERATION, SET);
    await completeOpportunityOperationStep(deps(), OPERATION, SET);

    expect(generated).toBe(1);
    expect(voiceRows()).toHaveLength(1);
    expect(novaUsage()).toHaveLength(1);
  });

  it("spends nothing while the switch is off", async () => {
    delete process.env.NOVA_VOICE_ENABLED;

    await completeOpportunityOperationStep(deps(), OPERATION, SET);

    expect(generated).toBe(0);
  });
});

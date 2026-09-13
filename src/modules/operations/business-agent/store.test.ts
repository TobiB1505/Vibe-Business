import { describe, expect, it } from "vitest";
import { fakeSupabase, FakeDatabase } from "../test-support";
import {
  appendMessage,
  createConversation,
  createTurnRun,
  deriveConversationTitle,
  getConversation,
  listMessages,
} from "./store";

/**
 * The conversation store, against the fake database.
 *
 * What these hold is the half of the design that is about *ownership and
 * order* rather than about answers: a thread belongs to one project, a
 * conversation id from another one resolves to nothing, sequence is assigned
 * by the store and not by a caller, and an artifact is a reference rather than
 * a copy.
 */

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";

function world() {
  const db = new FakeDatabase();
  return { db, supabase: fakeSupabase(db) };
}

describe("a conversation belongs to exactly one project", () => {
  it("does not resolve through a project it does not belong to", async () => {
    const { supabase } = world();
    const thread = await createConversation(supabase, {
      projectId: PROJECT,
      userId: USER,
      title: "What next",
    });

    expect(
      await getConversation(supabase, { conversationId: thread.id, projectId: PROJECT }),
    ).not.toBeNull();
    // The predicate, not an assertion: another project's id finds nothing.
    expect(
      await getConversation(supabase, { conversationId: thread.id, projectId: OTHER_PROJECT }),
    ).toBeNull();
  });
});

describe("messages have a stable order the store assigns", () => {
  it("numbers them from one, in the order they were written", async () => {
    const { supabase } = world();
    const thread = await createConversation(supabase, {
      projectId: PROJECT,
      userId: USER,
      title: "t",
    });

    await appendMessage(supabase, {
      conversationId: thread.id,
      projectId: PROJECT,
      role: "founder",
      content: "What should I work on next?",
      origin: "typed",
    });
    await appendMessage(supabase, {
      conversationId: thread.id,
      projectId: PROJECT,
      role: "assistant",
      content: "The thing to start with is pricing.",
      origin: "model",
      turnRunId: "44444444-4444-4444-4444-444444444444",
    });

    const messages = await listMessages(supabase, {
      conversationId: thread.id,
      projectId: PROJECT,
    });

    expect(messages.map((message) => message.sequence)).toEqual([1, 2]);
    expect(messages.map((message) => message.role)).toEqual(["founder", "assistant"]);
  });

  it("stores an artifact as a reference, never as a copy of the row", async () => {
    const { db, supabase } = world();
    const thread = await createConversation(supabase, {
      projectId: PROJECT,
      userId: USER,
      title: "t",
    });

    await appendMessage(supabase, {
      conversationId: thread.id,
      projectId: PROJECT,
      role: "assistant",
      content: "Start with the pricing Move.",
      origin: "model",
      turnRunId: "44444444-4444-4444-4444-444444444444",
      artifacts: [{ kind: "opportunity", subjectId: "opp-1" }],
    });

    const [artifact] = db.rows("agent_message_artifacts");
    expect(artifact.kind).toBe("opportunity");
    expect(artifact.subject_id).toBe("opp-1");
    /*
     * Nothing of the Move itself. The claim is stated as the absence of the
     * Move's own fields rather than as an exact key set, because the fake
     * database stamps its own bookkeeping columns and an exact list would fail
     * on those instead of on the thing this test is about.
     */
    for (const copied of ["title", "problem", "why_now", "rank", "impact", "effort", "content"]) {
      expect(Object.keys(artifact), copied).not.toContain(copied);
    }
  });
});

describe("nothing stores model reasoning", () => {
  it("writes no column a reasoning trace could occupy", async () => {
    const { db, supabase } = world();
    const thread = await createConversation(supabase, {
      projectId: PROJECT,
      userId: USER,
      title: "t",
    });
    await appendMessage(supabase, {
      conversationId: thread.id,
      projectId: PROJECT,
      role: "assistant",
      content: "One sentence.",
      origin: "model",
      turnRunId: "44444444-4444-4444-4444-444444444444",
    });

    const [message] = db.rows("agent_messages");
    for (const forbidden of ["reasoning", "thinking", "rationale", "trace", "prompt"]) {
      expect(Object.keys(message).join(" ")).not.toContain(forbidden);
    }
  });
});

describe("the turn run", () => {
  it("records the four versions a stored reply has to be readable against", async () => {
    const { db, supabase } = world();
    const thread = await createConversation(supabase, {
      projectId: PROJECT,
      userId: USER,
      title: "t",
    });
    const founder = await appendMessage(supabase, {
      conversationId: thread.id,
      projectId: PROJECT,
      role: "founder",
      content: "What next?",
      origin: "typed",
    });

    const created = await createTurnRun(supabase, {
      conversationId: thread.id,
      projectId: PROJECT,
      userId: USER,
      operationRunId: "55555555-5555-5555-5555-555555555555",
      founderMessageId: founder.id,
      promptVersion: "agent-turn-prompt-v1",
      toolRegistryVersion: "agent-tools-v1",
      skillRegistryVersion: "agent-skills-v1",
      policyVersion: "agent-policy-v1",
    });

    expect(created.ok).toBe(true);
    const [row] = db.rows("agent_turn_runs");
    expect(row.prompt_version).toBe("agent-turn-prompt-v1");
    expect(row.tool_registry_version).toBe("agent-tools-v1");
    expect(row.skill_registry_version).toBe("agent-skills-v1");
    expect(row.policy_version).toBe("agent-policy-v1");
    expect(row.status).toBe("queued");
    // Never written before the first paid call.
    expect(row.inference_started_at ?? null).toBeNull();
  });
});

describe("a conversation title is Vibe's, and derived", () => {
  it("takes the founder's own first sentence and bounds it on a word", () => {
    expect(deriveConversationTitle("What should I work on next?")).toBe(
      "What should I work on next?",
    );
    const long = deriveConversationTitle("a".repeat(20) + " " + "b".repeat(90));
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
  });

  it("never leaves a thread unnamed", () => {
    expect(deriveConversationTitle("   ")).toBe("New conversation");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK_FOR_ARTIFACT } from "@/modules/nova/blocks";
import { AGENT_ARTIFACT_KINDS } from "@/modules/business-agent/artifacts";
import {
  MAX_FOUNDER_MESSAGE_CHARS,
  MIN_FOUNDER_MESSAGE_CHARS,
} from "@/modules/business-agent/orchestrator/budgets";

/**
 * The conversation surface, asserted against its source.
 *
 * The browser suite proves what a founder can see; these prove the things a
 * screenshot cannot: that the thread renders artifacts from canonical rows
 * rather than from anything stored beside a message, that the composer and the
 * server agree on one bound, and that the focus was not replaced by a chat box.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]/nova");
const read = (file: string) => readFileSync(join(DIR, file), "utf8");

describe("the artifact registry is total", () => {
  it("gives every artifact kind a block", () => {
    expect(Object.keys(BLOCK_FOR_ARTIFACT).sort()).toEqual([...AGENT_ARTIFACT_KINDS].sort());
  });
});

describe("the thread renders canonical rows", () => {
  it("reads a Move through the block, never out of the message", () => {
    const source = read("nova-conversation.tsx");
    expect(source).toContain("BLOCK_FOR_ARTIFACT");
    expect(source).toContain("<MoveBlock");
    // The message carries a reference; the card is built from the opportunity
    // the reader resolved. Nothing is rendered out of the message's own text.
    expect(source).toContain("artifact.opportunity");
  });

  it("resolves a reference that no longer exists to nothing, not to a guess", () => {
    const reader = readFileSync(join(process.cwd(), "src/modules/nova/conversation.ts"), "utf8");
    expect(reader).toContain("movesById.get(artifact.subject_id)");
    expect(reader).toMatch(/return move\s*\?/);
  });
});

describe("the composer and the server share one bound", () => {
  it("takes its limit from the same constant the server enforces", () => {
    const composer = read("nova-composer.tsx");
    expect(composer).toContain("maxLength={MAX_FOUNDER_MESSAGE_CHARS}");
    expect(composer).toContain("MIN_FOUNDER_MESSAGE_CHARS");

    const server = readFileSync(
      join(process.cwd(), "src/modules/operations/business-agent/service.ts"),
      "utf8",
    );
    expect(server).toContain("MAX_FOUNDER_MESSAGE_CHARS");
    expect(server).toContain("MIN_FOUNDER_MESSAGE_CHARS");

    // And the constants are real numbers rather than a shape nobody set.
    expect(MAX_FOUNDER_MESSAGE_CHARS).toBeGreaterThan(100);
    expect(MIN_FOUNDER_MESSAGE_CHARS).toBeGreaterThan(0);
  });

  it("writes no client-side write to a conversation table", () => {
    for (const file of ["nova-composer.tsx", "nova-turn-live.tsx", "nova-conversation.tsx"]) {
      const source = read(file);
      expect(source, file).not.toContain("agent_messages");
      expect(source, file).not.toContain("agent_conversations");
      expect(source, file).not.toContain("createClient");
    }
  });
});

describe("the focus was added to, not replaced", () => {
  it("still renders the ranking above the conversation", () => {
    const home = read("nova-home.tsx");
    const focusAt = home.indexOf("<FocusSection");
    const threadAt = home.indexOf("<NovaConversation");
    expect(focusAt).toBeGreaterThan(-1);
    expect(threadAt).toBeGreaterThan(-1);
    // A founder who has never asked anything still arrives at an answer.
    expect(focusAt).toBeLessThan(threadAt);
  });
});

describe("progress is observed, never invented", () => {
  it("draws the stage the operation reports and no fraction", () => {
    const live = read("nova-turn-live.tsx");
    expect(live).toContain("OPERATION_STAGE_LABELS[live.stage]");
    expect(live).not.toMatch(/%|progress=\{|\bpercent\b/);
    // A run nothing is carrying still says something.
    expect(live).toContain('phase === "stalled"');
  });
});

describe("what Nova looked at is shown, and what she thought is not", () => {
  it("renders the steps above the reply", () => {
    const source = read("nova-conversation.tsx");
    expect(source).toContain("<NovaThinking");
    // Above, because that is the order they happened in.
    expect(source.indexOf("<NovaThinking")).toBeLessThan(source.indexOf("<NovaBubble"));
  });

  it("selects no column a founder should not be reading", () => {
    const reader = readFileSync(join(process.cwd(), "src/modules/nova/conversation.ts"), "utf8");
    /*
     * A window after the tool-call query rather than a slice between two
     * markers: `agent_turn_runs` appears earlier in this file for the live
     * turn, so slicing to its first occurrence read backwards and asserted
     * nothing.
     */
    const from = reader.indexOf('.from("agent_turn_tool_calls")');
    expect(from).toBeGreaterThan(-1);
    const select = reader.slice(from, from + 400);
    expect(select).toContain("turn_run_id, sequence, tool, decision, result_kind");
    // Identifiers, arguments and Vibe's own message to the model stay put.
    for (const withheld of ["input", "subject_ids", "denial_reason"]) {
      expect(select, withheld).not.toContain(withheld);
    }
  });

  it("never renders a tool's own name", () => {
    const component = readFileSync(
      join(process.cwd(), "src/components/nova/nova-thinking.tsx"),
      "utf8",
    );
    // The label comes from the catalogue; the stored string never reaches JSX.
    expect(component).toContain("step.label");
    expect(component).not.toMatch(/step\.tool|call\.tool/);
  });

  it("says looked at rather than thought, because nobody watched a thought", () => {
    const component = readFileSync(
      join(process.cwd(), "src/components/nova/nova-thinking.tsx"),
      "utf8",
    );
    const rendered = component.slice(component.indexOf("const summary ="));
    expect(rendered).toContain("Looked at");
    expect(rendered.toLowerCase()).not.toContain('"thought');
  });

  it("gives the shimmer an answer for reduced motion", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const block = css.slice(css.indexOf(".nova-thinking-live"));
    expect(block).toContain("prefers-reduced-motion");
    /*
     * The global kill switch stops the animation and would leave transparent
     * text over a static gradient, so this one puts the colour back rather
     * than relying on it.
     */
    expect(block).toContain("background-image: none");
    expect(block).toContain("color: var(--color-fg-secondary)");
  });
});

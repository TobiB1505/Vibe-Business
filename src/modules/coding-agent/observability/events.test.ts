import { describe, expect, it } from "vitest";
import {
  MAX_EVENT_STRING,
  MAX_METADATA_BYTES,
  MAX_METADATA_KEYS,
  REDACTED,
  boundEvent,
  classifyCommand,
  executionEvent,
  phaseOf,
  redactSecrets,
} from "./events";

/**
 * The event log's safety properties.
 *
 * Two of them matter more than the rest and both are about what an untrusted
 * repository can reach. It supplies the file names and the command lines that
 * end up in these rows, and the agent runs with a gateway bearer token on its
 * environment — so a command it composes really can carry a credential, and a
 * pathological tree really can try to turn one execution into an unbounded
 * table.
 */

describe("secrets never reach a stored event", () => {
  it("strips every credential shape the runtime can actually carry", () => {
    const cases = [
      "curl -H 'Authorization: Bearer vibe_agt_abcdef1234567890' https://gw",
      "ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA npm test",
      "export VIBE_AGENT_GATEWAY_SECRET=hunter2hunter2hunter2",
      "gh auth login --token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "git clone https://x-access-token:ghs_AAAAAAAAAAAAAAAAAAAA@github.com/o/r.git",
      "curl -H 'authorization: Bearer eyJhbGciOi.eyJzdWIiOjE.SflKxwRJSM'",
    ];

    for (const command of cases) {
      const cleaned = redactSecrets(command);
      expect(cleaned, command).toContain(REDACTED);
      for (const secret of ["vibe_agt_abcdef", "sk-ant-api03", "hunter2", "ghp_AAAA", "ghs_AAAA", "SflKxwRJSM"]) {
        expect(cleaned, `${command} → ${secret}`).not.toContain(secret);
      }
    }
  });

  /** Redaction runs at the boundary, so a new event type cannot forget it. */
  it("runs over the summary and every metadata value, not just commands", () => {
    const event = boundEvent({
      sequence: 1,
      type: "command_started",
      phase: "working",
      audience: "internal",
      occurredAt: "2026-08-19T10:00:00.000Z",
      summary: "Ran curl -H 'Authorization: Bearer vibe_agt_secretvalue'",
      metadata: {
        command: "echo ANTHROPIC_API_KEY=sk-ant-api03-XXXXXXXXXXXXXXXXXXXX",
        note: "token=ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("vibe_agt_secretvalue");
    expect(serialized).not.toContain("sk-ant-api03");
    expect(serialized).not.toContain("ghp_BBBB");
  });

  it("leaves an ordinary command readable", () => {
    expect(redactSecrets("pnpm run typecheck")).toBe("pnpm run typecheck");
  });
});

describe("bounded, because a repository is untrusted input", () => {
  it("cuts an over-long string and marks it", () => {
    const event = boundEvent({
      sequence: 1,
      type: "file_read",
      phase: "working",
      audience: "internal",
      occurredAt: "2026-08-19T10:00:00.000Z",
      summary: "x".repeat(5000),
      metadata: { path: `src/${"a".repeat(5000)}.ts` },
    });

    expect(event.summary.length).toBeLessThanOrEqual(MAX_EVENT_STRING + 1);
    expect(String(event.metadata.path).length).toBeLessThanOrEqual(MAX_EVENT_STRING + 1);
  });

  it("caps the number of metadata keys", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: MAX_METADATA_KEYS + 20 }, (_, index) => [`k${index}`, index]),
    );

    const event = boundEvent({
      sequence: 1,
      type: "file_read",
      phase: "working",
      audience: "internal",
      occurredAt: "2026-08-19T10:00:00.000Z",
      summary: "read",
      metadata,
    });

    expect(Object.keys(event.metadata).length).toBeLessThanOrEqual(MAX_METADATA_KEYS);
  });

  /** Sixteen keys of two hundred characters is still four kilobytes. */
  it("caps the serialized metadata size as well as the key count", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: MAX_METADATA_KEYS }, (_, index) => [`k${index}`, "v".repeat(400)]),
    );

    const event = boundEvent({
      sequence: 1,
      type: "file_read",
      phase: "working",
      audience: "internal",
      occurredAt: "2026-08-19T10:00:00.000Z",
      summary: "read",
      metadata,
    });

    expect(Buffer.byteLength(JSON.stringify(event.metadata), "utf8")).toBeLessThanOrEqual(
      MAX_METADATA_BYTES,
    );
  });

  it("replaces a non-finite number rather than storing it", () => {
    const event = boundEvent({
      sequence: 1,
      type: "file_read",
      phase: "working",
      audience: "internal",
      occurredAt: "2026-08-19T10:00:00.000Z",
      summary: "read",
      metadata: { bytes: Number.NaN, ratio: Number.POSITIVE_INFINITY },
    });

    expect(event.metadata).toEqual({ bytes: 0, ratio: 0 });
  });
});

describe("phase and audience are properties of the type", () => {
  it("puts every type in exactly one phase", () => {
    expect(phaseOf("workspace_ready")).toBe("preparing");
    expect(phaseOf("file_read")).toBe("working");
    expect(phaseOf("change_verified")).toBe("reviewing_change");
    expect(phaseOf("validation_started")).toBe("validating");
    expect(phaseOf("execution_failed")).toBe("finished");
  });

  /**
   * A founder watching their change gets milestones; the per-file detail is the
   * inspector's. The split is stored so a later production surface can render
   * the customer timeline with a query rather than a duplicated list.
   */
  it("marks milestones customer and detail internal", () => {
    const milestone = executionEvent({
      sequence: 1,
      type: "change_verified",
      occurredAt: "2026-08-19T10:00:00.000Z",
      summary: "6 files changed",
    });
    const detail = executionEvent({
      sequence: 2,
      type: "file_read",
      occurredAt: "2026-08-19T10:00:00.000Z",
      summary: "Read page.tsx",
    });

    expect(milestone.audience).toBe("customer");
    expect(detail.audience).toBe("internal");
  });
});

describe("what a command was for", () => {
  it("reads the script name rather than the first token", () => {
    expect(classifyCommand("pnpm run typecheck")).toBe("typecheck");
    expect(classifyCommand("pnpm install --frozen-lockfile")).toBe("install");
    expect(classifyCommand("npx vitest run src/x")).toBe("test");
    expect(classifyCommand("pnpm build")).toBe("build");
    expect(classifyCommand("git status --short")).toBe("git");
    expect(classifyCommand("rg --files src")).toBe("search");
  });

  it("falls back rather than guessing", () => {
    expect(classifyCommand("./scripts/do-the-thing.sh")).toBe("other");
  });
});

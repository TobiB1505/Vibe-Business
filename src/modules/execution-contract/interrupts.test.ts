import { describe, expect, it } from "vitest";
import {
  MUST_INTERRUPT_SITUATIONS,
  interruptToApprovedDecision,
  isInterruptBlocking,
  isValidInterruptAnswer,
} from "./interrupts";
import {
  EXECUTION_INTERRUPT_TYPES,
  EXECUTION_STOP_REASONS,
  type ExecutionInterrupt,
} from "./schema";
import { EXECUTION_INTERRUPT_QUESTIONS, EXECUTION_STOP_LABELS } from "./view";

/**
 * The interrupt and stop contract (EXECUTION CORE-3 §21, §22, §23, §34).
 */

function fakeInterrupt(overrides: Partial<ExecutionInterrupt> = {}): ExecutionInterrupt {
  return {
    id: "int-1",
    projectId: "project-1",
    executionSpecId: "spec-1",
    type: "business_decision_required",
    question: EXECUTION_INTERRUPT_QUESTIONS.business_decision_required,
    responseSchema: {
      kind: "single_choice",
      options: [
        { id: "email_password", label: "Email and password" },
        { id: "magic_link", label: "Magic links" },
      ],
    },
    whyBlocked: "business_decision_required",
    status: "open",
    createdAt: "2026-08-18T12:00:00.000Z",
    answeredAt: null,
    answer: null,
    ...overrides,
  };
}

describe("interrupt triggers (§22)", () => {
  it("covers every situation the contract can express", () => {
    expect([...MUST_INTERRUPT_SITUATIONS].sort()).toEqual([...EXECUTION_INTERRUPT_TYPES].sort());
  });

  it("has Vibe-authored copy for every situation, so a model never phrases the question", () => {
    for (const type of EXECUTION_INTERRUPT_TYPES) {
      expect(EXECUTION_INTERRUPT_QUESTIONS[type].length).toBeGreaterThan(0);
    }
  });
});

describe("stop conditions (§23)", () => {
  it("has customer-safe copy for every structural stop reason", () => {
    for (const reason of EXECUTION_STOP_REASONS) {
      expect(EXECUTION_STOP_LABELS[reason].length).toBeGreaterThan(0);
    }
  });

  it("includes the four that must never be reachable by policy relaxation", () => {
    expect(EXECUTION_STOP_REASONS).toContain("policy_violation_required");
    expect(EXECUTION_STOP_REASONS).toContain("secret_access_required");
    expect(EXECUTION_STOP_REASONS).toContain("prohibited_side_effect_required");
    expect(EXECUTION_STOP_REASONS).toContain("budget_exhausted");
  });
});

describe("interrupt answers (§21)", () => {
  it("accepts an answer matching the offered options", () => {
    const interrupt = fakeInterrupt();
    expect(
      isValidInterruptAnswer(interrupt.responseSchema, {
        kind: "single_choice",
        optionId: "magic_link",
      }),
    ).toBe(true);
  });

  it("rejects an option that was never offered", () => {
    const interrupt = fakeInterrupt();
    expect(
      isValidInterruptAnswer(interrupt.responseSchema, {
        kind: "single_choice",
        optionId: "sso_saml",
      }),
    ).toBe(false);
  });

  it("rejects an answer of a different kind than the question", () => {
    const interrupt = fakeInterrupt();
    expect(
      isValidInterruptAnswer(interrupt.responseSchema, { kind: "confirmation", confirmed: true }),
    ).toBe(false);
  });

  it("rejects text past the stated ceiling", () => {
    expect(
      isValidInterruptAnswer({ kind: "text", maxLength: 10 }, { kind: "text", value: "far too long" }),
    ).toBe(false);
    expect(isValidInterruptAnswer({ kind: "text", maxLength: 10 }, { kind: "text", value: "  " })).toBe(
      false,
    );
  });
});

describe("interrupts hold execution (§21, §23)", () => {
  it("blocks only while open", () => {
    expect(isInterruptBlocking(fakeInterrupt())).toBe(true);
    expect(isInterruptBlocking(fakeInterrupt({ status: "answered" }))).toBe(false);
    expect(isInterruptBlocking(fakeInterrupt({ status: "cancelled" }))).toBe(false);
    expect(isInterruptBlocking(fakeInterrupt({ status: "expired" }))).toBe(false);
  });
});

describe("an answer becomes structured business context (§28)", () => {
  it("turns an answered choice into an approved decision", () => {
    const interrupt = fakeInterrupt({
      status: "answered",
      answeredAt: "2026-08-18T13:00:00.000Z",
      answer: { kind: "single_choice", optionId: "magic_link" },
    });

    expect(interruptToApprovedDecision(interrupt)).toEqual({
      key: "interrupt:int-1",
      stepOrder: null,
      decision: "Magic links",
    });
  });

  it("produces nothing for an unanswered interrupt", () => {
    expect(interruptToApprovedDecision(fakeInterrupt())).toBeNull();
  });

  it("produces nothing for an answer that does not match the question", () => {
    const interrupt = fakeInterrupt({
      status: "answered",
      answeredAt: "2026-08-18T13:00:00.000Z",
      answer: { kind: "single_choice", optionId: "never_offered" },
    });

    expect(interruptToApprovedDecision(interrupt)).toBeNull();
  });
});

describe("no chain-of-thought (§34, Rule 43)", () => {
  it("has no field on an interrupt that could carry model reasoning", () => {
    const interrupt = fakeInterrupt() as unknown as Record<string, unknown>;
    for (const forbidden of ["reasoning", "thinking", "rationale", "transcript", "trace", "messages"]) {
      expect(interrupt).not.toHaveProperty(forbidden);
    }
  });
});

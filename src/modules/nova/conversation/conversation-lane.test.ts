import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The seven things this lane must never do (restructure audit §C.8).
 *
 * Every one of them is an existing rule, restated where a generative path could
 * erode it — and each erodes the same way: one reasonable-looking import. The
 * conversation layer reading a profile directly saves a hop. Holding the
 * service-role client makes a query simpler. Generating in the render removes a
 * round trip. None of them looks like a security decision at the moment it is
 * made, which is why the decision is a test instead of a paragraph.
 */

const MODULE = join(process.cwd(), "src", "modules", "nova", "conversation");
const FEATURE = join(process.cwd(), "src", "features", "nova", "conversation");
const INTENT = join(process.cwd(), "src", "modules", "nova", "intent");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) return [];
    if (entry.includes(".test.")) return [];
    return [full];
  });
}

const LANE = [...sourceFiles(MODULE), ...sourceFiles(FEATURE), ...sourceFiles(INTENT)];

function read(file: string): { name: string; body: string } {
  return { name: relative(process.cwd(), file), body: readFileSync(file, "utf8") };
}

describe("the conversation lane holds no capability", () => {
  it("finds the files it is about", () => {
    // An empty set would pass every assertion below while proving nothing.
    expect(LANE.length).toBeGreaterThan(6);
    expect(LANE.map((file) => relative(process.cwd(), file))).toContain(
      "src/modules/nova/conversation/service.ts",
    );
  });

  /**
   * Rule 53, and §C.8's first line: *the conversation reads under the founder's
   * own session and RLS; `service-boundary.test.ts` gains no entry.* The
   * service-role client bypasses RLS entirely, and a conversation layer holding
   * it is one bug away from reading across tenants.
   */
  it("never reaches for the service-role client", () => {
    for (const file of LANE.map(read)) {
      expect(file.body, file.name).not.toContain("createServiceClient");
      expect(file.body, file.name).not.toContain("supabase-service");
      expect(file.body, file.name).not.toContain("SERVICE_ROLE");
    }
  });

  /**
   * Rule 41: removing capability, not prompt wording, is what bounds prompt
   * injection. There is no tool, no web access, no URL fetch and no code
   * execution — and the way to be sure is that nothing here can reach one.
   */
  it("never fetches, never browses, never executes", () => {
    for (const file of LANE.map(read)) {
      expect(file.body, file.name).not.toMatch(/\bfetch\(/);
      expect(file.body, file.name).not.toContain("playwright");
      expect(file.body, file.name).not.toContain("node:child_process");
      expect(file.body, file.name).not.toContain("safeFetch");
      expect(file.body, file.name).not.toContain("createSandbox");
    }
  });

  /**
   * Rules 8, 62 and 79: no credential reaches model context. The Anthropic key
   * lives behind the provider adapter, and GitHub, Supabase, Stripe and sandbox
   * tokens have no business in a sentence.
   */
  it("never touches a credential", () => {
    for (const file of LANE.map(read)) {
      for (const secret of [
        "ANTHROPIC_API_KEY",
        "GITHUB_APP_PRIVATE_KEY",
        "STRIPE_SECRET",
        "SUPABASE_SERVICE_ROLE_KEY",
        "installationToken",
      ]) {
        expect(file.body, `${file.name} names ${secret}`).not.toContain(secret);
      }
    }
  });

  /**
   * Rules 67–74: no branch write, no merge, no approval through generated text.
   * An approval binds to an immutable artifact identity and a person; a
   * sentence can never be that. A merge intent resolves to the **approval**,
   * which is a control the founder presses.
   */
  it("never merges, approves or writes a branch", () => {
    for (const file of LANE.map(read)) {
      for (const effect of [
        "mergeApprovedChange",
        "createApproval",
        "startMerge",
        "pushBranch",
        "createBranch",
      ]) {
        expect(file.body, `${file.name} calls ${effect}`).not.toContain(`${effect}(`);
      }
    }
  });

  /**
   * Rule 60 and `audit-is-a-choice.test.ts`: a priced operation is always a
   * press. The lane may *propose* a catalogue id — which renders the control
   * that id already has, with its existing price and confirmation — and may
   * never start one itself.
   */
  it("starts nothing", () => {
    for (const file of LANE.map(read)) {
      expect(file.body, file.name).not.toMatch(/\bstart[A-Z]\w*Operation\(/);
      expect(file.body, file.name).not.toMatch(/\bstart(Audit|Plan|Agent|Validation|Preview)\w*\(/);
      expect(file.body, file.name).not.toContain("reserveCredits");
    }
  });

  /**
   * ADR 0109 §5, stronger than ADR 0086's condition 5: **generation happens in
   * a founder-initiated command, never in a read or a render.** That is what
   * keeps the cost of looking at a screen knowable, and it holds by there being
   * exactly one caller of the service, in a `"use server"` module.
   */
  it("generates in one command and nowhere else", () => {
    const callers = LANE.map(read).filter(
      (file) =>
        file.body.includes("answerNovaQuestion(") &&
        !file.name.endsWith("modules/nova/conversation/service.ts"),
    );

    expect(callers.map((file) => file.name)).toEqual([
      "src/features/nova/conversation/commands/ask-nova.ts",
    ]);
    expect(callers[0].body.startsWith('"use server"')).toBe(true);
  });

  /**
   * Rule 43: no model reasoning is requested, stored or displayed. The config
   * asks for none, and nothing here reads a `thinking` field back.
   */
  it("asks for no reasoning and reads none", () => {
    for (const file of LANE.map(read)) {
      expect(file.body, file.name).not.toContain("thinking:");
      expect(file.body, file.name).not.toContain(".thinking");
    }
  });
});

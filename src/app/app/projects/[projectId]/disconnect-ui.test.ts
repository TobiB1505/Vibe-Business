import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The disconnect failure surface, asserted against the UI source (VB-003).
 *
 * ## What this is, and what it is not
 *
 * A **source** assertion, in the same shape and for the same reason as
 * `merge-ui.test.ts`: this project has no React rendering harness, and the
 * browser suite renders fixture scenarios rather than driving a real Server
 * Action failure. So nothing here proves what a person sees. It proves what
 * copy the component can possibly render, and — the part that matters for
 * VB-003 — that it cannot render a database message.
 *
 * The behavioural half is covered where it is actually observable:
 * `disconnect-action.test.ts` proves the action does not navigate on failure
 * and returns only a closed code.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");
const src = readFileSync(join(DIR, "disconnect-button.tsx"), "utf8");

describe("the failure is shown rather than swallowed", () => {
  it("renders through useActionState, so a returned failure can reach the screen", () => {
    expect(src).toContain("useActionState");
    expect(src).toContain("action={formAction}");
  });

  it("carries fixed copy for every failure code, exhaustively", () => {
    // A `Record<DisconnectProjectFailure, string>` makes a new failure code
    // without copy a type error rather than a blank line in production.
    expect(src).toContain("Record<DisconnectProjectFailure, string>");
    expect(src).toMatch(/project_not_found:\s*"[^"]+"/);
    expect(src).toMatch(/deletion_failed:\s*"[^"]+"/);
  });

  it("tells the person the project is still connected when the delete refused", () => {
    // The one sentence that prevents the original defect: after a refused
    // disconnect the project IS still connected, and saying so is the whole fix.
    expect(src).toContain("still connected");
  });

  it("announces the failure to assistive technology", () => {
    expect(src).toContain('role="alert"');
  });

  it("renders the failure in both the confirming and idle states", () => {
    // The confirm panel closes on some paths; a failure that only rendered
    // inside it would be invisible exactly when it mattered.
    expect(src.match(/FAILURE_MESSAGES\[failure\]/g) ?? []).toHaveLength(2);
  });
});

describe("a second click cannot submit a second delete", () => {
  it("hands the pending flag to the confirmation panel", () => {
    // `ConfirmPanel` disables both buttons and shows the busy state while
    // pending, so the destructive submit is guarded rather than merely relabelled.
    expect(src).toContain("pending={pending}");
  });

  it("takes the pending flag from the action state, not from local state", () => {
    expect(src).toMatch(/const \[state, formAction, pending\] = useActionState\(/);
  });

  it("leaves the control usable again once the failure comes back", () => {
    // The panel stays mounted on failure — the component returns the confirming
    // branch whenever `confirming` is true, and nothing clears it on error — so
    // `pending` returning to false re-enables the button without a remount.
    expect(src).toContain("if (confirming) {");
    expect(src).not.toMatch(/setConfirming\(false\)[^)]*state/);
  });
});

describe("nothing database-shaped can reach the screen", () => {
  it("renders only from the fixed copy table, never from the state's payload", () => {
    // The failure state carries a code and nothing else, and the component
    // indexes the copy table with it. There is no interpolation of any
    // server-supplied string anywhere in the failure path.
    expect(src).not.toMatch(/\{\s*state\.(message|error)\s*\}/);
    expect(src).not.toContain("state.message");
    expect(src).not.toContain(".message}");
  });

  it("never mentions a table, trigger, constraint or SQLSTATE in its copy", () => {
    for (const forbidden of [
      "execution_specs",
      "constraint",
      "trigger",
      "foreign key",
      "SQLSTATE",
      "restrict_violation",
      "23503",
      "supabase",
    ]) {
      expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

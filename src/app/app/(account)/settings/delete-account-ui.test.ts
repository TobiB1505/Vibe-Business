import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The account erasure confirmation, asserted against the UI source.
 *
 * A **source** assertion, in the same shape and for the same reason as
 * `disconnect-ui.test.ts`: this project has no React rendering harness, so
 * nothing here proves what a person sees. It proves what copy the component can
 * possibly render.
 *
 * What makes it worth having anyway is that erasure's disclosures are not
 * decoration — three of them are decisions ADR 0056 made and recorded as
 * copy obligations. A confirmation that quietly dropped one would let somebody
 * consent to a consequence nobody stated, on the single action in this product
 * that cannot be undone.
 */

const DIR = join(process.cwd(), "src/app/app/(account)/settings");
const src = readFileSync(join(DIR, "delete-account.tsx"), "utf8");
const action = readFileSync(join(DIR, "delete-account-actions.ts"), "utf8");

describe("what the confirmation must disclose", () => {
  it("says it cannot be undone", () => {
    expect(src).toContain("cannot be undone");
  });

  it("says the GitHub App is not uninstalled (ADR 0056 §4)", () => {
    // Vibe has never uninstalled the App and this change does not add that
    // behaviour, so the copy has to say so. The ADR states the obligation in
    // exactly these terms: "the erasure copy states it; the code does not do it".
    expect(src).toContain("does not uninstall");
    expect(src).toContain("GitHub");
  });

  it("says the subscription is cancelled with no refund (ADR 0056 §9)", () => {
    // Cancellation is immediate rather than at period end, because the record
    // that would let Vibe reconcile the remaining period is about to be
    // tombstoned. The unrefunded remainder is the cost of that, and hiding it
    // would make the erasure a worse deal than it was described as.
    expect(src).toContain("not refunded");
  });

  it("says the billing history survives without the person's name (ADR 0056 §6, §9)", () => {
    // The disclosure most easily forgotten, because it is the one that
    // contradicts the word "delete". §6 retains the Credit ledger whole and §9
    // keeps the payment references; consenting to "delete everything" is not
    // consenting to that unless it is said.
    expect(src).toMatch(/ledger|billing history/i);
    expect(src).toMatch(/kept|survive/i);
  });

  it("says the person will not be able to sign back in", () => {
    expect(src).toContain("sign back in");
  });
});

describe("the failure surface", () => {
  it("carries fixed copy for every reason, exhaustively", () => {
    // A `Record<ErasureFailureReason, string>` makes a new reason without copy
    // a type error rather than a blank line in production.
    expect(src).toContain("Record<ErasureFailureReason, string>");
    for (const reason of [
      "billing_not_finalized",
      "stripe_cancel_failed",
      "project_deletion_failed",
      "erasure_start_failed",
      "unknown",
    ]) {
      expect(src).toMatch(new RegExp(`${reason}:\\s*\n?\\s*"[^"]+"`));
    }
  });

  it("tells the person nothing was erased when it refused", () => {
    // The VB-003 sentence, in its erasure form. A refused erasure leaves the
    // account entirely intact, and saying so is what stops a person believing
    // their data is half-gone.
    const refusals = src.match(/"[^"]*(?:erased|changed)[^"]*"/g) ?? [];
    expect(refusals.length).toBeGreaterThan(2);
    expect(src).toContain("Nothing was erased");
  });

  it("cannot render a database message", () => {
    // The closed union is the whole guarantee: there is no interpolation of a
    // caught error anywhere in this component.
    expect(src).not.toMatch(/\{\s*(?:error|err)\.message\s*\}/);
    expect(src).not.toContain("String(error)");
  });
});

describe("the action", () => {
  it("takes no argument naming an account", () => {
    // The owner is `requireSession()`'s and the RLS insert policy checks it
    // again. A request that named somebody else would have nowhere to put it.
    expect(action).toContain("export async function deleteAccountAction()");
    expect(action).toContain("requireSession()");
  });

  it("uses the session client, not the RLS-bypassing one", () => {
    expect(action).toContain('from "@/lib/supabase/server"');
    expect(action).not.toContain("createServiceClient");
  });

  it("does not redirect, because the account still exists when it returns", () => {
    // Redirecting somewhere final would claim an outcome that has not happened:
    // the erasure has only been enqueued.
    expect(action).not.toContain("redirect(");
  });
});

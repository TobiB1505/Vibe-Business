import { describe, expect, it } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";
import { creditUnits, creditsToUnits, formatCreditUnits } from "./units";
import { readRefundConfirmation, refundConfirmationRefusal } from "./refund-confirmation";
import { refundCharge } from "./service";

/**
 * The operator path for correcting a charge (VB-038).
 *
 * `refundCharge` has existed, complete and idempotent and audited, with **zero
 * callers**. So the honest description of this product's billing was: a
 * customer could be charged for something Vibe got wrong, and nobody —
 * including the person operating it — had any way to give the Credits back.
 *
 * ## Why this shape and not a screen
 *
 * A refund is rare, consequential, and needs someone who can be held to it. A
 * UI would need an operator role and an admin surface, neither of which exists,
 * and inventing an authorization model to move money is a decision well beyond
 * "the finding says there is no path". The audit says a CLI or probe is
 * acceptable, and this repository already has the shape for *deliberate,
 * credentialed, human-run* work: a `*.probe.ts`, excluded from
 * `vitest.config.mts`'s `*.test.ts` include, so CI can never reach a database
 * through it.
 *
 * ## Running it
 *
 * ```
 * VIBE_REFUND_CHARGE_ID=<billing_credit_ledger.id of the charge> \
 * VIBE_REFUND_CREDITS=20 \
 * VIBE_REFUND_REASON="audit produced no result — support ticket 41" \
 * pnpm billing:refund
 * ```
 *
 * **It refuses to write until you say so.** Without `VIBE_REFUND_CONFIRM=yes`
 * it reads the charge, prints what it would post, and stops. That is the
 * default because the input is a UUID typed by a person at the moment they are
 * annoyed about a support ticket, and the operation moves money.
 *
 * **A near miss fails rather than going quiet.** `VIBE_REFUND_CONFIRM=true` is
 * not the word, and it is refused out loud instead of silently becoming a dry
 * run — see `refund-confirmation.ts` for why that distinction is the whole
 * point. The word is not widened to accept `true`, `1` or `y`: that would
 * remove the confusing case by making a deliberate switch less deliberate.
 *
 * ## Why a re-run is safe
 *
 * The idempotency key is derived from the charge and the amount, so running the
 * same command twice posts one refund and reports the second as already done.
 * That is deliberate: an operator who is not sure whether the first run landed
 * must be able to simply run it again. Refunding a *different* amount is a
 * different key and will post — which is correct, and is why the dry run prints
 * what has already been refunded before you confirm anything.
 */

const CHARGE_ID = process.env.VIBE_REFUND_CHARGE_ID ?? "";
const CREDITS = Number(process.env.VIBE_REFUND_CREDITS ?? "0");
const REASON = process.env.VIBE_REFUND_REASON ?? "";
const CONFIRMATION = readRefundConfirmation(process.env.VIBE_REFUND_CONFIRM);

/** Deterministic, so the same correction run twice is one refund. */
function idempotencyKey(chargeId: string, credits: number): string {
  return `operator_refund:${chargeId}:${credits}`;
}

describe.skipIf(CHARGE_ID.length === 0)("correcting one charge", () => {
  it("reads the charge, and writes only when confirmed", async () => {
    expect(CREDITS, "VIBE_REFUND_CREDITS must be a positive number of Credits").toBeGreaterThan(0);
    expect(REASON.trim().length, "VIBE_REFUND_REASON must say why").toBeGreaterThan(0);

    const supabase = createServiceClient();

    const { data: charge, error } = await supabase
      .from("billing_credit_ledger")
      .select("id, kind, credit_delta, credit_account_id, project_id, reason, created_at")
      .eq("id", CHARGE_ID)
      .maybeSingle();

    if (error) throw error;
    expect(charge, `no ledger entry ${CHARGE_ID}`).not.toBeNull();

    const row = charge as {
      kind: string;
      credit_delta: number;
      credit_account_id: string;
      project_id: string | null;
      reason: string | null;
      created_at: string;
    };

    const { data: priorRefunds } = await supabase
      .from("billing_credit_ledger")
      .select("id, credit_delta, reason, created_at")
      .eq("refunds_ledger_entry_id", CHARGE_ID);

    // Printed before anything is decided, because this is the moment an
    // operator finds out they are about to refund the wrong charge.
    console.info("[refund] the charge", {
      id: CHARGE_ID,
      kind: row.kind,
      chargedCredits: formatCreditUnits(creditUnits(row.credit_delta)),
      creditAccountId: row.credit_account_id,
      projectId: row.project_id,
      reason: row.reason,
      createdAt: row.created_at,
    });
    console.info("[refund] already refunded", priorRefunds ?? []);
    console.info("[refund] would post", {
      credits: CREDITS,
      reason: REASON,
      idempotencyKey: idempotencyKey(CHARGE_ID, CREDITS),
    });

    /*
     * A value that is present but not the word is its own outcome, and it
     * fails rather than falling through to the dry run.
     *
     * Somebody who set nothing wants the dry run. Somebody who typed `true`
     * wanted the refund, and treating that as "no" gives them a run that looks
     * exactly like success — output appears, the command exits cleanly, and
     * the customer is still owed their Credits. Failing safe is right; failing
     * safe *silently* is how a person stops trusting a tool that was working.
     */
    if (CONFIRMATION.kind === "not_the_word") {
      expect.fail(refundConfirmationRefusal(CONFIRMATION.given));
    }

    if (CONFIRMATION.kind === "dry_run") {
      console.info("[refund] DRY RUN — set VIBE_REFUND_CONFIRM=yes to post it");
      return;
    }

    const result = await refundCharge(supabase, {
      chargeLedgerEntryId: CHARGE_ID,
      credits: creditsToUnits(CREDITS),
      reason: REASON,
      idempotencyKey: idempotencyKey(CHARGE_ID, CREDITS),
    });

    console.info("[refund] result", result);
    expect(result.ok, `refused: ${result.ok ? "" : result.refusal}`).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_TRAIL_RETENTION_MONTHS,
  FINANCIAL_RECORD_RETENTION_YEARS,
  OPERATIONAL_EVENT_RETENTION_DAYS,
  SWEPT_TABLES,
} from "@/modules/retention/periods";

/**
 * The published period must be the enforced period.
 *
 * GDPR Art. 13(2)(a) requires the notice to state how long records are kept,
 * and until 2026-09-02 it stated nothing — zero matches for days, months or
 * years. That was a gap. **Filling it with a number nothing honours would be
 * worse than the gap**, because a gap is an omission and a wrong period is a
 * false statement to every reader who acts on it.
 *
 * Two periods on that page are now claims about a `pg_cron` job that runs every
 * night (ADR 0069). Nothing except this file connects the sentence a customer
 * reads to the interval that job actually uses, and the two live in different
 * languages in different directories — which is exactly the shape that drifts.
 *
 * ## What this cannot check
 *
 * That the job runs, that it succeeded last night, or that the sweep reaches
 * the rows the sentence describes. Those are properties of a database, and this
 * is a text comparison. It catches the failure that a code change causes; it
 * does not catch the failure an outage causes.
 */

const PAGE = join(process.cwd(), "src/app/privacy/page.tsx");

function page(): string {
  return readFileSync(PAGE, "utf8");
}

describe("the privacy notice states the periods retention actually enforces", () => {
  it("publishes the operational period the sweep uses", () => {
    expect(page()).toContain(`${OPERATIONAL_EVENT_RETENTION_DAYS} days`);
  });

  it("publishes the audit period the sweep uses", () => {
    expect(page()).toContain(`${AUDIT_TRAIL_RETENTION_MONTHS} months`);
  });

  it("publishes the statutory period for financial records", () => {
    // Spelled out rather than numeric: this is prose a person reads, and the
    // constant is what makes the sentence checkable rather than decorative.
    expect(FINANCIAL_RECORD_RETENTION_YEARS).toBe(10);
    expect(page()).toContain("up to ten years");
  });

  it("states both swept periods and no third one", () => {
    // A period appearing on the page that the sweep does not implement is the
    // false-statement failure this file exists to prevent.
    const published = new Set(
      [...page().matchAll(/(\d+)\s(days|months)\b/g)].map((m) => `${m[1]} ${m[2]}`),
    );
    expect(published).toEqual(new Set(SWEPT_TABLES.map((t) => t.interval)));
  });

  it("promises no deletion for the classes nothing deletes", () => {
    const source = page();
    // The financial and derived classes are described as what is *kept*. ADR
    // 0068 §3 and §6 decided periods for both and ADR 0069 §7 built neither, so
    // "then deleted" would be a promise with nothing behind it.
    const financial = source.slice(source.indexOf("Billing and payment records"));
    const sentence = financial.slice(0, financial.indexOf("</li>"));
    expect(sentence).toContain("Vibe cannot delete these on");
    expect(sentence).not.toMatch(/automatically|then deleted|removed after/);
  });

  it("keeps the unbuilt half of the promise on the pending list", () => {
    // The page's own convention: what does not exist is listed, not implied.
    expect(page()).toContain("An automatic deletion of billing records at the end");
  });

  it("dates the notice to when the periods were published", () => {
    expect(page()).toContain('updated="2 September 2026"');
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * How the provenance panel is wired into the screen that spends, asserted
 * against the source.
 *
 * Two things can go wrong here and neither is visible to a rendering test.
 *
 * The first is **a second opinion**. The panel's whole claim is that it agrees
 * with the button beside it, and it does so by being built from the same
 * `evidence`, `auditReadiness` and `auditCurrency` the gate uses. A page that
 * called `readAuditEvidence` twice, or resolved the currency again for the
 * panel, could show a founder one answer while refusing them on another —
 * and both halves would be individually correct.
 *
 * The second is **cost**. VB-022 measured four fetches of the repository
 * snapshot and four of the live snapshot per render of the most-visited route
 * in the product, on multi-hundred-kilobyte JSONB columns, and fixed it by
 * reading once. A panel that went back to the database would put half of that
 * straight back.
 */

const HEALTH = join(process.cwd(), "src/app/app/projects/[projectId]/health/content.tsx");

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the panel is fed from what the page already read", () => {
  const body = code(HEALTH);

  it("builds the chain from the shared evidence", () => {
    expect(body).toContain("provenanceInputsFrom({");
    expect(body).toMatch(/provenanceInputsFrom\(\{\s*evidence,/);
  });

  it("takes the readiness and the currency the audit gate uses", () => {
    expect(body).toMatch(/readiness:\s*auditReadiness/);
    expect(body).toMatch(/currency:\s*auditCurrency/);
  });

  /** One read model, one answer. */
  it("reads the evidence exactly once", () => {
    expect(body.match(/readAuditEvidence\(/g) ?? []).toHaveLength(1);
  });

  it("resolves the audit's currency exactly once", () => {
    expect(body.match(/getAuditCurrency\(/g) ?? []).toHaveLength(1);
  });

  it("narrows the chain to the action this screen sells", () => {
    expect(body).toMatch(/provenanceForAction\([\s\S]*?"business_audit"/);
  });

  it("renders it", () => {
    expect(body).toContain("<ProvenancePanel");
  });
});

describe("the panel cannot spend", () => {
  const files = [
    join(process.cwd(), "src/app/app/projects/[projectId]/provenance-panel.tsx"),
    join(process.cwd(), "src/modules/provenance/chain.ts"),
    join(process.cwd(), "src/modules/provenance/actions.ts"),
    join(process.cwd(), "src/modules/provenance/view.ts"),
  ];

  /**
   * The panel's own remedy is a link to a screen, never a start. Every action
   * it names is paid or consequential, and a surface whose job is to warn
   * about spending must not be able to cause it — the free Product Scan
   * included, because "free" is a price and not a permission.
   */
  it.each(files)("%s starts nothing", (file) => {
    const body = code(file);

    for (const starter of [
      "startProductScanOperation",
      "startBusinessAudit",
      "startOpportunity",
      "holdOperationCredits",
      "VercelWorkflowExecutor",
    ]) {
      expect(body, `${file} → ${starter}`).not.toContain(starter);
    }
  });

  it.each(files)("%s obtains no service-role client", (file) => {
    expect(code(file)).not.toContain("@/lib/supabase/service");
  });

  it.each(files)("%s reaches no AI provider", (file) => {
    const body = code(file);

    expect(body).not.toContain("@/modules/ai/provider");
    expect(body).not.toContain("@/modules/ai/anthropic");
  });
});

describe("the chain does not query", () => {
  /**
   * `chain.ts` is pure so that the panel cannot become a read model of its
   * own. The adapter beside it takes documents; neither takes a client.
   */
  it.each(["chain.ts", "actions.ts", "from-evidence.ts", "view.ts"])(
    "%s takes no Supabase client",
    (file) => {
      const body = code(join(process.cwd(), "src/modules/provenance", file));

      expect(body).not.toContain("SupabaseClient");
      expect(body).not.toContain("supabase");
    },
  );
});

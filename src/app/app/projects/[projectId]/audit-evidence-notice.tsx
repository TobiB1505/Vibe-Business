import Link from "next/link";
import type { AuditEvidenceNotice } from "@/modules/business-audit/evidence-notice";

/**
 * The Deep Scan evidence notice above the Business Audit (Sprint 6 §11).
 *
 * Informational only — it never disables the audit button, and it never
 * suggests a Deep Scan will raise the score. The Deep Scan itself is started
 * from its own panel, so the action here is a jump to that panel rather than a
 * second copy of a paid, irreversible action.
 */
export function AuditEvidenceNotice({
  notice,
  deepScanHref,
}: {
  notice: AuditEvidenceNotice;
  /**
   * Where the Deep Scan panel actually is.
   *
   * Was `href="#deep-scan"`, written when the workspace was one page. The UI-2
   * route split moved Deep Scan onto its own URL and left the fragment behind,
   * so the only action this notice offers has scrolled nowhere ever since.
   */
  deepScanHref: string;
}) {
  if (notice.kind === "none") return null;

  if (notice.kind === "deep_scan_stale") {
    return (
      <div className="space-y-2 rounded-md border border-line-2 px-3 py-2">
        <p className="text-sm text-fg-prose">New product evidence available</p>
        <p className="text-sm text-fg-muted">
          A Deep Scan has run since this audit was produced. Re-running the audit spends another AI
          call and may change the result in either direction.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-line-2 px-3 py-2">
      <p className="text-sm text-fg-prose">
        Vibe has not analyzed your signed-in product experience yet.
      </p>
      <p className="text-sm text-fg-muted">
        Your audit can still run, but a Deep Scan may provide additional product evidence.
      </p>
      {notice.canStartDeepScan && (
        <Link
          href={deepScanHref}
          className="inline-block text-sm text-fg-prose underline underline-offset-2 hover:text-fg"
        >
          Run included Deep Scan
        </Link>
      )}
    </div>
  );
}

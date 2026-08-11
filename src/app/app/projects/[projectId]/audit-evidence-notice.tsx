import type { AuditEvidenceNotice } from "@/modules/business-audit/evidence-notice";

/**
 * The Deep Scan evidence notice above the Business Audit (Sprint 6 §11).
 *
 * Informational only — it never disables the audit button, and it never
 * suggests a Deep Scan will raise the score. The Deep Scan itself is started
 * from its own panel, so the action here is a jump to that panel rather than a
 * second copy of a paid, irreversible action.
 */
export function AuditEvidenceNotice({ notice }: { notice: AuditEvidenceNotice }) {
  if (notice.kind === "none") return null;

  if (notice.kind === "deep_scan_ready") {
    return (
      <div className="flex items-baseline justify-between gap-3 rounded-md border border-zinc-800 px-3 py-2 text-sm">
        <span className="text-zinc-400">Authenticated product evidence</span>
        <span className="text-emerald-400">Ready</span>
      </div>
    );
  }

  if (notice.kind === "deep_scan_stale") {
    return (
      <div className="space-y-2 rounded-md border border-zinc-800 px-3 py-2">
        <p className="text-sm text-zinc-300">New product evidence available</p>
        <p className="text-sm text-zinc-500">
          A Deep Scan has run since this audit was produced. Re-running the audit spends another AI
          call and may change the result in either direction.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-zinc-800 px-3 py-2">
      <p className="text-sm text-zinc-300">
        Vibe has not analyzed your signed-in product experience yet.
      </p>
      <p className="text-sm text-zinc-500">
        Your audit can still run, but a Deep Scan may provide additional product evidence.
      </p>
      {notice.canStartDeepScan && (
        <a
          href="#deep-scan"
          className="inline-block text-sm text-zinc-300 underline underline-offset-2 hover:text-zinc-50"
        >
          Run included Deep Scan
        </a>
      )}
    </div>
  );
}

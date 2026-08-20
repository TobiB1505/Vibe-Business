import { BUSINESS_LENSES } from "@/modules/business-audit/schema";
import { LENS_LABELS } from "@/modules/business-audit/map-view";

/**
 * The landing page's product proof (UI-S1 §5).
 *
 * ## Why this rather than a screenshot
 *
 * Because there is no honest screenshot to use. Every completed Business Map in
 * existence belongs to a real repository, and a fabricated one would be exactly
 * the invented result the sprint forbids — a made-up score is a made-up claim
 * whether it sits in a marketing image or in a database.
 *
 * So the proof is the part of the audit that is true before any product is
 * connected: **the nine areas, and the fact that they get ordered by when they
 * matter**. Both are read from the domain — `BUSINESS_LENSES` and `LENS_LABELS`
 * are the same constants the real map renders from, so an area that is added,
 * removed or renamed changes this section too rather than leaving it to drift.
 *
 * ## What is deliberately absent
 *
 * Health values, scores, percentages, priority assignments. Every one of those
 * is a judgment about a specific product, and there is no product here. The
 * tiles carry an em dash and the caption says why, which is a truer thing to
 * show a visitor than a plausible-looking verdict about nobody.
 */

/** The real priority vocabulary the map groups by, in reading order. */
const RINGS = ["Needs attention now", "Soon", "Later"] as const;

export function BusinessMapPreview() {
  return (
    <div
      className="border-line-2 bg-surface-2 rounded-card relative overflow-hidden border p-5 sm:p-8"
      // Decorative composition, not an interactive control and not data. It is
      // announced by the surrounding section's heading and caption instead.
      role="presentation"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 0%, rgb(0 229 160 / 0.07), transparent 64%)",
        }}
      />

      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-fg-meta font-mono text-[0.65625rem] tracking-[0.16em] uppercase">
            Business audit
          </span>
          <span className="text-fg-faint" aria-hidden>
            ·
          </span>
          <span className="text-fg-meta font-mono text-[0.65625rem] tracking-[0.16em] uppercase">
            Nine areas
          </span>
        </div>

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BUSINESS_LENSES.map((lens) => (
            <li
              key={lens}
              className="border-line-2 bg-app/70 flex min-w-0 flex-col gap-2 rounded-xl border px-3 py-3"
            >
              <span className="text-fg-secondary text-ui leading-tight font-medium">
                {LENS_LABELS[lens]}
              </span>
              <span className="flex items-center gap-2">
                <span className="bg-line-track h-1 flex-1 rounded-full" aria-hidden />
                <span className="text-fg-faint font-mono text-meta" aria-hidden>
                  —
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="border-line-2 flex flex-col gap-3 border-t pt-5">
          <ul className="flex flex-wrap items-center gap-2">
            {RINGS.map((ring) => (
              <li
                key={ring}
                className="border-line-2 text-fg-muted rounded-full border px-3 py-1.5 text-xs"
              >
                {ring}
              </li>
            ))}
          </ul>
          <p className="text-fg-muted max-w-[56ch] text-xs leading-relaxed">
            Each area gets a plain-language verdict and a place in that order, worked out from your
            own product. Nothing is filled in here, because nothing has been connected yet.
          </p>
        </div>
      </div>
    </div>
  );
}

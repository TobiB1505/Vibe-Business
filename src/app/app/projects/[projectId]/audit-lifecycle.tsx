import { BUSINESS_LENSES } from "@/modules/business-audit/schema";
import { LENS_LABELS } from "@/modules/business-audit/map-view";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The audit's own states, drawn as states (AUDIT UI-1 §28–§37).
 *
 * Not one completed map wearing different headlines. Each of these says
 * something different about what Vibe is doing, and the difference is the
 * point — a founder should be able to tell "getting ready", "waiting for you"
 * and "thinking" apart at a glance.
 *
 * ## What is deliberately absent
 *
 * `5 / 9 LENSES` and lens-by-lens landing, which 1b's running mockup shows.
 * That mockup predates the final architecture: all nine lenses come from a
 * single inference call, so there is no moment at which five are finished.
 * Rendering it would be a progress bar that invents its own numbers, and this
 * project already rejected that in UI-2 for the same reason.
 *
 * What replaces it is honest and, I think, no less alive: the nine areas are
 * named and lit, because Vibe genuinely is working through all of them — just
 * not in an order anything can observe.
 */

/**
 * The nine areas, breathing.
 *
 * Motion is CSS-only and staggered by index, so nothing here runs a JS
 * animation loop or re-renders (§43). `motion-reduce` drops it entirely rather
 * than slowing it down, because the point of the preference is no movement.
 */
function LensConstellation({ active }: { active: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2">
      {BUSINESS_LENSES.map((lens, index) => (
        <li
          key={lens}
          className={`text-fg-meta font-mono text-[0.6875rem] tracking-[0.08em] uppercase ${
            active ? "motion-safe:animate-pulse" : ""
          }`}
          style={active ? { animationDelay: `${index * 140}ms`, animationDuration: "2.6s" } : undefined}
        >
          {LENS_LABELS[lens]}
        </li>
      ))}
    </ul>
  );
}

function Shell({
  label,
  headline,
  children,
}: {
  label: string;
  headline: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-live="polite"
      className="rounded-panel border-line-2 bg-surface-1 relative overflow-hidden border p-6"
    >
      {/* A single radial wash, not a glass panel (§58). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgb(0 229 160 / 0.06), transparent 62%)",
        }}
      />
      <div className="relative flex flex-col gap-4">
        <MonoLabel>{label}</MonoLabel>
        <p className="text-fg max-w-[46ch] text-lg font-medium">{headline}</p>
        {children}
      </div>
    </section>
  );
}

/**
 * Preparing (§31).
 *
 * Before the paid call, and before any founder question has been decided on.
 * The nine areas are named because they are what Vibe is about to look at —
 * but nothing carries a health or a priority yet, because nothing has been
 * judged. Showing a dimmed version of the *previous* audit's verdicts here
 * would be the stale-as-current defect §36 warns about.
 */
export function AuditPreparing() {
  return (
    <Shell label="Business audit · preparing" headline="Vibe is checking what it already knows.">
      <LensConstellation active={false} />
      <p className="text-fg-muted max-w-[58ch] text-sm">
        Nothing has been judged yet. Vibe is gathering what it has about your product before it
        looks at the business.
      </p>
    </Shell>
  );
}

/**
 * Analyzing (§29, §30).
 *
 * One call, all nine areas, no claimed per-lens completion. The copy says what
 * is true — Vibe is reading the whole business — and the motion carries the
 * energy the mockup gets from its fake progress.
 */
export function AuditAnalyzing() {
  return (
    <Shell label="Business audit · analyzing" headline="Vibe is reading the whole business.">
      <LensConstellation active />
      <p className="text-fg-muted max-w-[58ch] text-sm">
        All nine areas are judged together, so there is no order to watch. This usually takes a
        couple of minutes — you can leave this page and come back.
      </p>
    </Shell>
  );
}

/**
 * Waiting on the founder (§33, §34).
 *
 * The one piece of copy the mockup gets factually wrong: it says "the scan
 * keeps running". It does not. The audit is paused, has spent nothing, and
 * will spend nothing until this is answered — which is a better thing to say
 * anyway, because it tells the founder the cost of taking their time is zero.
 *
 * The question itself is rendered by `NeedsUserPanel`; this is the frame that
 * puts it in the audit's lifecycle rather than beside it.
 */
export function AuditWaitingHeader() {
  return (
    <div className="flex flex-col gap-2">
      <MonoLabel>Business audit · waiting for you</MonoLabel>
      <p className="text-fg-muted max-w-[58ch] text-sm">
        Vibe has everything else it needs. Answer this and the audit carries on — nothing has been
        spent while it waits.
      </p>
    </div>
  );
}

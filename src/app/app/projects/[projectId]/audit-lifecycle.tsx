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
    <>
      <div
        role="group"
        className="relative mx-auto hidden aspect-square w-full max-w-[28rem] sm:block"
        aria-label="Nine business lenses"
      >
        <span
          aria-hidden="true"
          className="border-line-2 absolute inset-[7%] rounded-full border"
        />
        <span
          aria-hidden="true"
          className="border-line-strong absolute inset-[23%] rounded-full border"
        />
        <span
          aria-hidden="true"
          className="border-mint/20 absolute inset-[39%] rounded-full border"
        />
        {active && (
          <span
            aria-hidden="true"
            className="audit-map-sweep absolute inset-[7%] rounded-full"
          />
        )}
        <span
          aria-hidden="true"
          className={`border-mint/30 bg-app absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border ${
            active ? "text-mint" : "text-fg-meta"
          }`}
        >
          <span className="font-mono text-[0.5625rem] tracking-[0.12em] uppercase">
            {active ? "reading" : "forming"}
          </span>
        </span>

        <ul>
          {BUSINESS_LENSES.map((lens, index) => {
            const radians = ((index * (360 / BUSINESS_LENSES.length) - 90) * Math.PI) / 180;
            const left = 50 + Math.cos(radians) * 40;
            const top = 50 + Math.sin(radians) * 40;
            return (
              <li
                key={lens}
                className={`border-line-2 bg-app/95 text-fg-secondary absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2.5 py-2 text-center text-meta leading-tight font-medium ${
                  active ? "motion-safe:animate-pulse" : ""
                }`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  ...(active
                    ? { animationDelay: `${index * 140}ms`, animationDuration: "2.6s" }
                    : {}),
                }}
              >
                {LENS_LABELS[lens]}
              </li>
            );
          })}
        </ul>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:hidden" aria-label="Nine business lenses">
        {BUSINESS_LENSES.map((lens, index) => (
          <li
            key={lens}
            className={`border-line-2 bg-app/70 text-fg-secondary rounded-lg border px-3 py-2.5 text-sm ${
              active ? "motion-safe:animate-pulse" : ""
            }`}
            style={
              active
                ? { animationDelay: `${index * 140}ms`, animationDuration: "2.6s" }
                : undefined
            }
          >
            {LENS_LABELS[lens]}
          </li>
        ))}
      </ul>
    </>
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
      className="rounded-panel border-line-2 bg-surface-2 relative overflow-hidden border p-6 sm:p-8"
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
      <div className="relative flex flex-col gap-5">
        <MonoLabel as="h2" className="text-fg-secondary">
          {label}
        </MonoLabel>
        <p className="text-fg max-w-[38ch] text-2xl leading-tight font-semibold tracking-[-0.03em]">
          {headline}
        </p>
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
    <div className="flex flex-col gap-3 pt-2">
      <MonoLabel as="h2" className="text-mint">
        Vibe needs you · Business audit waiting for you
      </MonoLabel>
      <p className="text-fg max-w-[46ch] text-xl leading-snug font-semibold tracking-[-0.025em]">
        Vibe found the one part of the business only you can clarify.
      </p>
      <p className="text-fg-muted max-w-[58ch] text-sm leading-relaxed">
        Vibe has everything else it needs. Answer this and the audit carries on — nothing has been
        spent while it waits.
      </p>
    </div>
  );
}

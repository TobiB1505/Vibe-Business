import { CostDisclosure } from "@/components/system/cost-disclosure";
import { SourceCoverageStrip } from "@/components/system/source-coverage";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { EXAMPLE_SOURCES } from "./landing-sources";

/**
 * Why this can be believed — as a bento, with real parts in the tiles.
 *
 * ## What it replaces
 *
 * Three bullet rows with an icon each. They named the three sources Vibe reads
 * and stopped there, which is a claim about coverage and not about trust — and
 * trust is the thing a visitor with no account is actually weighing.
 *
 * ## Why the tiles carry components rather than illustrations
 *
 * The bento is the catalogue's pattern (kinfe123, uilayout), and in every one
 * of them the large tiles hold an abstract 3D render. That is what a template
 * has to do, because it has no product behind it. Here the same slots hold the
 * source strip, a resolved price and the status vocabulary — the actual parts,
 * doing the actual thing the sentence beside them claims.
 *
 * The price in particular is not typed into this file: `CostDisclosure`
 * resolves it from the rate card in force, so a landing page cannot advertise
 * a number the product has stopped charging.
 */
export function LandingTrust() {
  return (
    <section id="product" aria-labelledby="trust-heading" className="scroll-mt-24 py-20 sm:py-28">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col items-start gap-5">
          <MonoLabel className="text-mint">Why you can act on it</MonoLabel>
          <h2
            id="trust-heading"
            className="text-fg max-w-[22ch] text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
          >
            An opinion you can <span className="text-mint">check</span>.
          </h2>
          <p className="text-fg-prose max-w-[62ch] leading-relaxed">
            Vibe is wrong sometimes. What it does not do is hide which part was a reading, which
            was a guess, and which was never looked at.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {/* Large: what the whole judgement rests on, at strip density. */}
          <article className="border-line-2 bg-surface-2 rounded-card flex flex-col justify-between gap-6 border p-6 lg:col-span-2">
            <div className="flex flex-col gap-2">
              <MonoLabel>Four sources, and the gaps between them</MonoLabel>
              <p className="text-fg text-lead font-semibold">
                Every reading says what it rests on.
              </p>
              <p className="text-fg-muted max-w-[52ch] text-body leading-relaxed">
                A source that could not be finished says why. One that was never run is not counted
                as evidence — and the line under every priced action tells you which is which.
              </p>
            </div>
            <div className="border-line-1 bg-surface-3 rounded-well border p-4">
              <SourceCoverageStrip sources={EXAMPLE_SOURCES} />
            </div>
          </article>

          {/* Small: the merge guarantee, in the product's own words. */}
          <article className="border-line-2 bg-surface-2 rounded-card flex flex-col justify-between gap-6 border p-6">
            <div className="flex flex-col gap-2">
              <MonoLabel>Your branch, your call</MonoLabel>
              <p className="text-fg text-lead font-semibold">One exact commit waits for you.</p>
              <p className="text-fg-muted text-body leading-relaxed">
                Vibe writes to an isolated branch. Your approval binds to that commit and no other
                — if the branch moves, the merge stops rather than guessing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="success">Validated</StatusPill>
              <StatusPill tone="waiting">Waiting for you</StatusPill>
              <StatusPill tone="neutral">Not merged</StatusPill>
            </div>
          </article>

          <article className="border-line-2 bg-surface-2 rounded-card flex flex-col justify-between gap-6 border p-6">
            <div className="flex flex-col gap-2">
              <MonoLabel>Before you press</MonoLabel>
              <p className="text-fg text-lead font-semibold">Never a surprise charge.</p>
              <p className="text-fg-muted text-body leading-relaxed">
                Every paid action states its price and your balance first. Free ones say so instead
                of staying quiet.
              </p>
            </div>
            <div className="border-line-1 bg-surface-3 rounded-well flex flex-wrap items-center gap-x-4 gap-y-2 border p-4">
              <span className="text-fg-secondary text-body">Deep Scan</span>
              <CostDisclosure operation="deep_scan" />
              <span className="text-line-strong">·</span>
              <span className="text-fg-secondary text-body">Scan again</span>
              <CostDisclosure operation="product_understanding" />
            </div>
          </article>

          <article className="border-line-2 bg-surface-2 rounded-card flex flex-col gap-2 border p-6">
            <MonoLabel>Your code</MonoLabel>
            <p className="text-fg text-lead font-semibold">No stored copy.</p>
            <p className="text-fg-muted text-body leading-relaxed">
              Vibe keeps what it concluded and the paths that justify it. Not your source, not your
              README, not your configs.
            </p>
          </article>

          <article className="border-line-2 bg-surface-2 rounded-card flex flex-col gap-2 border p-6">
            <MonoLabel>When it does not know</MonoLabel>
            <p className="text-fg text-lead font-semibold">
              A dash, <span className="text-fg-muted">—</span> not a zero.
            </p>
            <p className="text-fg-muted text-body leading-relaxed">
              An area Vibe could not assess is left unscored and kept out of the average. Missing
              evidence is never counted as a bad result.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

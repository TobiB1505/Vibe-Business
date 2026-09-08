import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { VibeCard } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { formatCreditsForDisplay } from "@/modules/credits/units";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import type { DeepScanSpotlight as Spotlight } from "@/modules/authenticated-product-intelligence/spotlight";

/**
 * Deep Scan, at the top of My Product (founder report, 2026-09-08).
 *
 * ## What it replaces
 *
 * A link. Deep Scan's only entrance was the word "Deep Scan" inside the
 * "Your signed-in product" source row, rendered at the same weight as "Add
 * your website" — so the most revealing source Vibe has, and the only one a
 * founder pays for, was the least visible thing on the page. Worse, a scan
 * that had already run said nothing here at all: twenty-two pages read behind
 * a login, and My Product showed `4 pages` in grey inside a list.
 *
 * ## Why it sits directly under the Product Scan
 *
 * Because that is what it is: the second half of the same reading. The
 * Product Scan reads the code and the public site; this reads the product a
 * customer actually uses. Putting it after the profile would have made it a
 * footnote to an understanding it is supposed to inform.
 *
 * ## What it deliberately does not do
 *
 * It does not run anything. The scan itself lives on its own route because
 * that route carries a 240-second function ceiling, and the panel there owns
 * the browser handover, the live view and the login timer. This is a doorway
 * with the answer written on it — never a second control that could start a
 * paid operation from a page that has not loaded the state to authorise it.
 */
export function DeepScanSpotlight({ spotlight, href }: { spotlight: Spotlight; href: string }) {
  const readAt = spotlight.analyzedAt ? formatTimestamp(spotlight.analyzedAt) : null;

  return (
    <VibeCard
      padding="lg"
      data-testid="deep-scan-spotlight"
      data-state={spotlight.state}
      className="flex flex-col gap-5"
    >
      <SectionHeader
        label="Deep Scan"
        title={spotlight.headline}
        description={spotlight.detail}
        actions={
          spotlight.state === "in_progress" ? <StatusPill tone="active">Running</StatusPill> : null
        }
      />

      {/*
        Counted facts, and only the ones that were counted. An absent measure
        renders as nothing rather than as a zero — "0 screens" is a finding
        about a product, and this card has no business inventing one.
      */}
      {(spotlight.facts.length > 0 || readAt) && (
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          {spotlight.facts.map((fact) => (
            <Metric key={fact.label} label={fact.label} value={fact.value} mono />
          ))}
          {readAt && <Metric label="Last read" value={readAt} />}
        </div>
      )}

      {/*
        The surfaces, by name. The evidence behind each one is a drawer on the
        Deep Scan panel; repeating it here would put the same citations in two
        places and make one of them the stale copy.
      */}
      {spotlight.surfaces.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid="deep-scan-spotlight-surfaces">
          {spotlight.surfaces.map((surface) => (
            <li
              key={surface}
              className="border-line-2 bg-surface-2 rounded-nav text-fg-body border px-3 py-1 text-sm"
            >
              {surface}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {spotlight.action && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={href}
              className={buttonClasses({
                /*
                 * A finished scan is not a call to action — the founder has
                 * already paid for it, and the primary thing on this page is
                 * still the Product Scan above. An unrun scan is.
                 */
                variant: spotlight.state === "read" ? "secondary" : "primary",
              })}
            >
              {spotlight.action.label}
            </Link>
            {spotlight.action.price !== null && (
              <span className="text-fg-secondary text-ui tabular-nums">
                {formatCreditsForDisplay(spotlight.action.price)} Credits
              </span>
            )}
            {spotlight.action.included && (
              <span className="text-fg-meta text-ui">
                Included with this project — one per project.
              </span>
            )}
          </div>
        )}

        {/*
          Never a card with neither a way forward nor a reason there is none.
          `buildDeepScanSpotlight` guarantees the pairing; this renders it.
        */}
        {spotlight.note && <p className="text-fg-muted max-w-[62ch] text-ui">{spotlight.note}</p>}
      </div>
    </VibeCard>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { SegmentedControl } from "@/components/ui/list-controls";
import { PALETTE_STORAGE_KEY, type Palette } from "@/app/palette";

/**
 * Flip the design system, here, now.
 *
 * ## Why this exists beside `VIBE_PALETTE`
 *
 * Because the environment variable is a *deployment's* answer and it takes
 * effect at build time — the root layout is baked into every statically
 * prerendered page, so changing it means a redeploy ([ADR 0098](../../../docs/decisions/0098-the-palette-ships-behind-one-switch.md)).
 * That is right for "what do customers see" and useless for "does this screen
 * work in both", which is the question every screen in the redesign now has to
 * answer twice.
 *
 * So: the variable decides the default, and this decides what *you* are looking
 * at, per browser, with no rebuild and no reload.
 *
 * ## Why it is not in production
 *
 * It is a tool for the person doing the redesign, not a preference. A customer
 * offered a switch between a finished design and an unfinished one has been
 * handed a decision that is not theirs. `getAppEnvironment()` already answers
 * "which tier is this", so the gate costs no new configuration — and the whole
 * control disappears with the scope when v2 is simply what everybody has.
 *
 * ## Why the writing happens in two places
 *
 * `localStorage` cannot be read during server rendering, so a switch that only
 * ran on mount would paint the deployment's palette first and the chosen one a
 * frame later — the whole product would flash on every navigation. The blocking
 * script in `layout.tsx` applies the stored value before first paint; this
 * component owns the control and keeps the two in step.
 */

const OPTIONS = [
  { value: "v1" as const, label: "v1" },
  { value: "v2" as const, label: "v2" },
];

/**
 * The attribute on `<html>` is the truth, so the control reads it rather than
 * keeping a second copy.
 *
 * `useSyncExternalStore` rather than an effect that sets state: the value
 * genuinely differs between the server (which knows only the deployment) and
 * the browser (where the boot script may already have applied an override),
 * and this is React's own answer for exactly that. An effect would set state
 * on mount — which lints, and which is a frame late by construction.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-vibe"] });
  return () => observer.disconnect();
}

export function PaletteSwitch({ deployed }: { deployed: Palette }) {
  const palette = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.vibe === "v2" ? "v2" : "v1"),
    () => deployed,
  );

  function choose(next: Palette) {
    // Writing the attribute is what changes the product; the observer above
    // turns that into a re-render, so there is no second place holding state.
    document.documentElement.dataset.vibe = next;
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch {
      // A private window or blocked storage. The switch still works for this
      // page; it simply will not be remembered, which is better than throwing
      // inside a click handler in a rail.
    }
  }

  return (
    /*
      Stacked rather than a row: the account rail is ~230px and "Design
      system · local" beside a two-option segment wraps, which puts the
      override marker on a line of its own looking like a second label.
    */
    <div className="border-line-1 mt-1 flex flex-col gap-2 border-t px-3 pt-3">
      <span className="text-fg-meta text-caption">
        Design system
        {palette !== deployed && (
          /* So a screenshot says whether it is showing the deployment or a
             local override — the two look identical in a bug report. */
          <span className="text-amber"> · local override</span>
        )}
      </span>
      <SegmentedControl
        label="Design system"
        name="vibe-palette"
        value={palette}
        onChange={choose}
        options={OPTIONS}
        className="self-start"
      />
    </div>
  );
}

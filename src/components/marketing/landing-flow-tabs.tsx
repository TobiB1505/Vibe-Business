"use client";

import { useId, useState, type ReactNode } from "react";
import { TabList, tabPanelId, tabTriggerId } from "@/components/ui/tabs";

/**
 * The six steps, walkable rather than listed.
 *
 * ## What it replaces
 *
 * A static grid of six cards, each an icon, a title and two lines. It said
 * what the product does and showed none of it — six equal tiles with no way
 * in, which is the shape a visitor skims past.
 *
 * The pattern is from the catalogue (CodeForge puts a tab strip under its hero
 * and switches one large panel below it); what is not from the catalogue is
 * what goes in the panel. Those templates fill it with a rendered mockup.
 * Every panel here is the **real component** from the product, given stated
 * example data — which is the one thing a landing page for this product can do
 * that a template cannot, because it is the only one whose screens have to be
 * honest anyway.
 *
 * ## Why the panels arrive pre-rendered
 *
 * The tab state is client-side and several of those components reach into
 * server-only modules for their own reasons — a price resolver, an evidence
 * label table. So the page renders all six on the server and this component
 * only decides which one is visible. Nothing here imports a product module.
 */

export type FlowTab = {
  id: string;
  label: string;
  /** What this stage produces, said in the product's own words. */
  headline: string;
  panel: ReactNode;
};

export function LandingFlowTabs({ tabs }: { tabs: readonly FlowTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const idBase = useId().replace(/[^a-zA-Z0-9]/g, "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  if (!current) return null;

  return (
    <div className="flex flex-col gap-6" data-testid="landing-flow">
      <TabList
        tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
        value={current.id}
        onSelect={setActive}
        label="How Vibe turns code into progress"
        idBase={idBase}
      />

      {/*
        One panel region, reserved to fit the tallest stage — not to a floor
        the short ones happen to clear.
        
        The difference is the whole obligation: a floor of 26rem left the
        source list overflowing it and every other panel sitting inside it, so
        a tab click moved the page 337px under the reader. A browser test
        measures the panel across a switch, which is the only way this stays
        true as the panels change.
      */}
      <div
        role="tabpanel"
        id={tabPanelId(idBase, current.id)}
        aria-labelledby={tabTriggerId(idBase, current.id)}
        className="border-line-2 bg-surface-2 rounded-card flex min-h-[36rem] flex-col gap-6 border p-5 sm:p-7"
      >
        <p className="text-fg max-w-[60ch] text-lead font-semibold">{current.headline}</p>
        <div className="min-w-0">{current.panel}</div>
      </div>
    </div>
  );
}

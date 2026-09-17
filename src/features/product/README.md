# Product

What Vibe understands about the customer's product, as a surface: the Product
Scan experience a founder watches, and — from Slice 2 — the My Product screen,
the understanding panel and the Deep Scan spotlight.

`ProductScanExperience` moved out of `src/components/product-scan/` in Slice 1;
Slice 2 brought the rest of the surface out of the route tree.

```
product-scan-experience.tsx  the scan a founder watches; four variants, one view
understanding-panel.tsx      what Vibe concluded the product is
understanding-confirm.tsx    the founder's correction, which outranks it
understanding-progress.tsx   the wait — mounted by nothing today
deep-scan-spotlight.tsx      a doorway with the answer written on it
deep-scan-panel.tsx          the authenticated scan, and its live browser
live-browser-canvas.tsx      the canvas and the input forwarding behind it
scan-handoff.tsx             the sealing animation between the two
scan-glyphs.tsx              its icon set
intelligence-summary.tsx     repository evidence — mounted by nothing today
live-intelligence-summary.tsx  public-page evidence — mounted by nothing today
```

The Deep Scan's route keeps `maxDuration = 240` and is still the only route in
the workspace allowed to raise the ceiling — `workspace-routes.test.ts` holds
that, and moving the panel did not move the ceiling.

What the product _is_ stays in
[`src/modules/product-understanding/`](../../modules/product-understanding/README.md),
[`src/modules/repository-intelligence/`](../../modules/repository-intelligence/README.md),
`live-product-intelligence/` and `authenticated-product-intelligence/`. The
budgets, the same-origin rule and the safe-fetch boundary are theirs; nothing
here can widen them.

Its two Server Action imports are recorded in
`src/lib/consistency/feature-boundaries.test.ts` and close when Slice 3 gives
this feature a `commands.ts`. The three files nothing mounts are named above
rather than quietly kept; Slice 8 deletes what nothing reaches.

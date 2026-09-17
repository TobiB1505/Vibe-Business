# Experiments

What a merged change made measurable, and what became true afterwards.

`experiment-card.tsx` moved out of the route tree by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 2.
It renders one `ProjectImpactEntry` from
[`src/modules/business-measurement/`](../../modules/business-measurement/README.md)
and nothing else — the route loads `getProjectImpact` and maps.

Vibe reports what it observed and never claims a change caused it. That is not
a style rule: `findCausalClaims` in `modules/business-measurement/causality.ts`
fails the build on a causal verb in this file, which is why the section is
called Experiments and still says "observed".

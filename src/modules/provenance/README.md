# modules/provenance

What a paid action will be built on, said before it is bought.

Built. Vibe's work is a chain: two scans produce a product profile, the profile produces an audit, the audit produces Moves, the Moves produce a plan. Every link is derived from the one above it, and until this module existed no screen said so. On 2026-09-02 a live scan taken before a classifier fix recorded "no pricing surface" about a page displaying three prices; the profile, the audit, its rank-1 critical blocker and the founder's whole plan were all derived from it, each internally consistent, each paid for.

`chain.ts` draws that chain. Each link carries what Vibe holds, when it produced it, and — for the two scans — which analyzer version produced it against the one running now. `firstGap` is the only link worth repairing: everything below a broken one is derived from it, so replacing the third while the first is wrong buys a fresh document built on the same mistake.

**It is provenance, not a badge, and that is the design.** A tick over "everything is current" is only as trustworthy as the version behind it, and the incident is precisely the case where that version was stale while the code was fixed — a light comparing v3 to v3 would have shown green over the evidence that was wrong. `src/lib/versions/analyzer-versions.test.ts` closes that particular hole; it cannot close the general one. A date and a version string are checkable by the person paying; a tick is a claim they have to take on faith.

**It decides nothing.** Every judgment comes from the module that owns it — the scans' versions from `business-audit`'s `outdatedScans`, the profile from `getAuditReadiness`, the audit from `getAuditCurrency`, the Move set from `getLatestOpportunities` — and `from-evidence.ts` takes them from what the calling page has already read rather than querying again (VB-022). A panel that could disagree with the button beside it would be worse than no panel.

The one judgment this module does add is the chain rule: a document cannot be more current than its own evidence. `isProfileCurrent` hashes a snapshot's **id**, and a corrected analyzer does not move an id — so a profile built on a scan Vibe knows is wrong hashes identical and reports itself current. `built_on_outdated` is that sentence, and it is the one that was missing.

`actions.ts` maps each `RetailOperationKind` to the links it reads, as a total `Record` so a new priced operation cannot arrive without the compiler asking. It is the **evidence** chain only: an agent execution also rests on a prepared change, a validation and a human approval bound to one immutable commit (rules 66–68), none of which is modelled here.

`view.ts` holds every sentence a founder reads, swept by `provenance-copy.test.ts` — no figures, no causal claims, no promise that a re-run produces a better answer. The single price claim on the panel, that a Product Scan is free, is checked against `modules/credits`' rate card rather than repeated from it.

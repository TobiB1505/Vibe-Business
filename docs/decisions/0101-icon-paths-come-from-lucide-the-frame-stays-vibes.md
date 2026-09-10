# 0101 - Icon paths come from Lucide; the frame stays Vibe's

Status: Accepted
Date: 2026-09-06

Adds `scripts/generate-icons.mjs`, `src/components/ui/icon-frame.tsx` and the generated `src/components/ui/icons.generated.tsx`. Adds no runtime dependency and no icon package. Supersedes the "icons are hand-authored" half of [ADR 0095](0095-design-tooling-is-repo-native.md)'s working rule.

## Context

`dashboard-icons.tsx` holds 36 hand-drawn icons, and the design-system skill records the reason: there is no icon package, so a pasted catalogue component importing `lucide-react` does not compile. That rule protected something real — a component that imports its visual language from a catalogue has its visual language decided somewhere else.

It also had a cost nobody had priced. The set had **no close mark**, which is why every dismissal in the product is the word "Close" or "Cancel" — including the one in a drawer header, where a word is the least conventional answer available. There is no pencil and no trash can either, so the destructive controls are words too. The rule was not producing restraint; it was producing gaps, and each gap was being filled by prose.

Drawing more by hand answers that badly. A pencil is not a design decision. It is a shape a thousand products have already agreed on, and re-deriving it is work with no product in it.

## Decision

### Take the paths, not the package

The geometry already matches, which is what makes this cheap rather than a migration. Checked before anything was written:

| | viewBox | caps / joins | fill | stroke width |
|---|---|---|---|---|
| Vibe's `IconFrame` | `0 0 24 24` | round | none | **1.8, on the frame** |
| Lucide | `0 0 24 24` | round | none | 2, on the path |

The one difference lives on the frame rather than in the path, so a Lucide path rendered through `IconFrame` inherits Vibe's weight and sits beside the 36 hand-drawn marks without any of them looking different.

So the rule narrows rather than reverses: **no icon package, still — but path data is not a package.** No component imports from a catalogue, nothing new appears in `package.json`, and `cn` never meets a `lucide-react` class list.

### A generator, run on demand, output committed

`scripts/generate-icons.mjs` holds a manifest of Vibe name → Lucide name, fetches from `lucide-static` at a pinned version, and emits the components. Adding an icon is one line and one command.

It runs when a person runs it, and the generated file is committed — the same argument `fonts.ts` already makes for self-hosting: a build that reaches a third party is a build that fails for reasons unrelated to the code, and this repository has already lost a CI run exactly that way.

Names are Lucide's own, so a designer and a developer can name the same thing without a translation table.

### The manifest starts at three

`EditIcon`, `DeleteIcon`, `DismissIcon` — the marks the inline-action work needs. Lucide has 1,600 more and none of them are here, because a catalogue is exactly how a product acquires three different marks for "settings". An icon enters the manifest when a screen needs it.

The hand-drawn `CloseIcon` added hours earlier is deleted in the same change: two dismissal marks would have been the first instance of the problem this decision exists to avoid.

### The stroke is stated in screen pixels, not in viewBox units

Raised as "the cross looks painted on, not like an icon", and true of all thirty-nine marks rather than that one.

`stroke-width` in SVG is expressed in viewBox units. The viewBox is 24, so a literal `1.8` renders at `1.8 × size / 24` on screen — 1.8px only at 24px, a size this product never uses. It renders icons at 13 to 22, and at 15, 16 and 17 for almost everything:

| size | before | uses |
|---|---|---|
| 13px | **0.98px** | 5 |
| 15px | **1.13px** | 26 |
| 16px | **1.20px** | 22 |
| 17px | **1.28px** | 16 |
| 24px | 1.80px | 0 |

Every icon in the product was drawn with a sub-pixel stroke, which a display resolves by spreading the line across two rows of pixels at partial opacity. That is the soft, sketched quality. It was never the shape.

`IconFrame` now states the stroke in screen pixels and converts: `strokeWidth = 1.5 × 24 / size`, so the rendered weight is 1.5px at every size. 1.5 rather than 1.8 because at 15–17px, where this product lives, 1.8px is heavier than the type beside it.

**This is the first change in the v2 work that alters what v1 renders**, and it does so deliberately. The old behaviour is not a style v1 chose; it is a unit that was never converted, in a set drawn for a size the product does not use.

### What stays hand-drawn

Everything product-specific. Nova's aperture, the wordmark, the nine navigation marks that carry Vibe's own vocabulary — no catalogue has them, and a catalogue that did would be drawing Vibe's identity. `dashboard-icons.tsx` keeps them and now imports the shared frame instead of restating it.

## Consequences

**Two icon files, and the split has to be understood.** Generated commons, hand-drawn identity. A person adding an icon has to know which file it belongs in; the generated file's header says so, and it says "do not edit" because it is rewritten.

**Lucide's licence is ISC**, which needs no attribution in the interface. It is recorded here and in the generated file rather than in a footer.

**A pinned version means a deliberate upgrade.** Regenerating against a newer Lucide could change a shape under a screen nobody re-looked at, so the version moves when somebody moves it.

**The design-system skill's "icons are hand-authored" line is now false** and is corrected in the same change. The half that survives — no icon package, no catalogue import in a component — is the half that was doing the work.

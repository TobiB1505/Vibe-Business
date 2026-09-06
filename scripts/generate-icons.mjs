import { writeFileSync } from "node:fs";

/**
 * Generates `src/components/ui/icons.generated.tsx` from Lucide's path data.
 *
 * ## Why a generator and not a dependency
 *
 * `lucide-react` would be a runtime dependency and an icon package, which the
 * design system does not have and does not want: a component importing from a
 * catalogue is a component whose visual language is decided somewhere else.
 * What is actually wanted is the *path data* — the part nobody should be
 * drawing by hand — inside Vibe's own frame.
 *
 * Lucide fits verbatim because the geometry already matches: `viewBox
 * 0 0 24 24`, round caps and joins, `fill="none"`, stroke on `currentColor`.
 * The one difference is stroke width — Lucide draws at 2, Vibe at 1.8 — and
 * that lives on `IconFrame`, not on the path, so an imported path inherits
 * Vibe's weight and sits beside the 36 hand-drawn icons without any of them
 * looking different.
 *
 * ## Why it runs on demand and commits its output
 *
 * The same reason `fonts.ts` self-hosts: a build that reaches a third party is
 * a build that fails for reasons unrelated to the code, and this repository has
 * already lost a CI run that way. This script is run by a person when the
 * manifest changes; the generated file is committed and is what ships.
 *
 * ## Adding an icon
 *
 * One line in MANIFEST, then `node scripts/generate-icons.mjs`. Names are
 * Lucide's own — https://lucide.dev/icons — so a designer and a developer can
 * name the same thing.
 *
 * Licence: ISC. Attribution is not required in the interface; it is recorded
 * in ADR 0097 and in the generated file's header.
 */

/** Pinned, so regenerating the file twice produces the file twice. */
const VERSION = "1.41.0";
const BASE = `https://cdn.jsdelivr.net/npm/lucide-static@${VERSION}/icons`;

/**
 * Vibe's name → Lucide's name.
 *
 * Deliberately short. An icon enters this list when a screen needs it, not
 * because a catalogue has it — 1,600 available icons is exactly how a product
 * ends up with three different marks for "settings".
 */
const MANIFEST = {
  EditIcon: "pencil",
  DeleteIcon: "trash-2",
  DismissIcon: "x",
};

const HEADER = `import type { SVGProps } from "react";
import { IconFrame } from "./icon-frame";

/**
 * GENERATED FILE — do not edit.
 *
 * \`node scripts/generate-icons.mjs\` rewrites it from Lucide ${VERSION} (ISC).
 * Add an icon by adding a line to that script's MANIFEST and re-running it.
 *
 * The paths are Lucide's; the frame, the stroke weight and the sizing are
 * Vibe's, so these sit beside the hand-drawn marks in \`dashboard-icons.tsx\`
 * without looking imported. Product-specific marks — Nova's aperture, the
 * wordmark — stay hand-drawn there, because no catalogue has them.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
`;

/** Everything inside `<svg …>` … `</svg>`, which is all Vibe needs. */
function innerSvg(source) {
  const match = source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!match) throw new Error("no <svg> in the response");
  return match[1].replace(/\s+/g, " ").replace(/> </g, ">\n      <").trim();
}

const parts = [HEADER];

for (const [component, icon] of Object.entries(MANIFEST)) {
  const response = await fetch(`${BASE}/${icon}.svg`);
  if (!response.ok) throw new Error(`${icon}: HTTP ${response.status}`);
  const body = innerSvg(await response.text());

  parts.push(`
/** Lucide \`${icon}\`. */
export function ${component}(props: IconProps) {
  return (
    <IconFrame {...props}>
      ${body}
    </IconFrame>
  );
}
`);
  console.log(`${component.padEnd(14)} ← lucide/${icon}`);
}

writeFileSync("src/components/ui/icons.generated.tsx", parts.join("") + "");
console.log(`\nwrote src/components/ui/icons.generated.tsx (lucide ${VERSION})`);

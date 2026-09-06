/**
 * The three Nova Home direction studies (S0).
 *
 * ## What a study is, and what it is not
 *
 * A study is a *direction*, rendered at full fidelity on the real view models,
 * so material and motion can be judged by looking rather than argued about. It
 * is not a wireframe — the risk in this redesign is glass, light and
 * choreography, and a grey box makes exactly those invisible.
 *
 * It is also not product code. Everything under `design-studies/` is reachable
 * only through the fixture route, which is a 404 in production and needs
 * `VIBE_E2E_FIXTURES=1` everywhere else. Nothing here is imported by `/app`.
 *
 * ## Why the accent is a variable of the study
 *
 * Mint (`#00e5a0`) is Vibe's brand and `DESIGN.md` gives it a specific job —
 * *Vibe is acting*, never generic approval. A new design system is the one
 * cheap moment to ask whether that job needs that colour, so two of the three
 * studies answer it differently and the decision gets made at the picture.
 * Study A keeps mint unchanged and is the control.
 *
 * ## Why the type scale moves with the material
 *
 * A typeface is not a swap. Geist, Switzer and Instrument Sans have different
 * x-heights and different natural rhythm, so each study sets its own display
 * sizes and tracking. Judging three directions through one type scale would be
 * judging none of them.
 */

export type StudyId = "a" | "b" | "c";

export type Study = {
  id: StudyId;
  /** The scenario slug the fixture route answers to. */
  scenario: string;
  name: string;
  /** The one-line argument the study is making. */
  thesis: string;
  /** What is deliberately different here — read beside the screenshot. */
  material: string;
  accent: string;
  /** Named so a reviewer can say "the violet one" and be understood. */
  accentName: string;
  typeface: string;
};

export const STUDIES: readonly Study[] = [
  {
    id: "a",
    scenario: "study-a-depth",
    name: "Depth & Glass",
    thesis: "Vibe is a lit instrument you look into, and depth is what makes it feel expensive.",
    material:
      "Layered glass over a tinted atmosphere. Soft light, a real z-axis, generous corners. The ground stops being near-black so there is something for the blur to carry.",
    accent: "#00e5a0",
    accentName: "Mint — unchanged",
    typeface: "Geist",
  },
  {
    id: "b",
    scenario: "study-b-precision",
    name: "Precision & Light",
    thesis: "Vibe is an instrument that measures, and precision is what makes it feel expensive.",
    material:
      "Edge-driven and dark. Glass is spent on chrome and overlays only; panels stay opaque so dense data never sits behind a blur. Light is a focus tool, not an ambience.",
    accent: "#5b9dff",
    accentName: "Signal blue",
    typeface: "Switzer",
  },
  {
    id: "c",
    scenario: "study-c-editorial",
    name: "Editorial & Motion",
    thesis: "Vibe is writing you a briefing, and the writing is what makes it feel expensive.",
    material:
      "Typography leads and the material gets out of the way. Serif display, wide measure, hairline rules, almost no fill. Premium comes from choreography and layout, not from surface treatment.",
    accent: "#a98bff",
    accentName: "Orchid",
    typeface: "Instrument Sans + Instrument Serif",
  },
] as const;

export function studyByScenario(scenario: string): Study | null {
  return STUDIES.find((study) => study.scenario === scenario) ?? null;
}

export function isStudyScenario(scenario: string): boolean {
  return studyByScenario(scenario) !== null;
}

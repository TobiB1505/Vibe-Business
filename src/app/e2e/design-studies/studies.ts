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

export type StudyId = "a" | "b" | "c" | "chosen";

/**
 * The material a study builds its surfaces from.
 *
 * A separate field rather than a branch on the id, because the three axes a
 * study varies — material, accent, typeface — turned out to be chosen
 * *independently*: the direction picked at review was B's material with A's
 * typeface and mint. An id-shaped conditional cannot express that, and the
 * fourth study is what proved it.
 */
export type StudySkin =
  /** Layered glass over a lit field. Needs atmosphere behind it to refract. */
  | "glass"
  /** Opaque panel, bright hairline, tight corner. Safe under dense data. */
  | "panel"
  /** No box at all — a rule and space. Type carries the structure. */
  | "rule";

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
  skin: StudySkin;
  /**
   * A single directional light across the top of the focused card. It says
   * *this one*, so it appears on exactly one element per screen or not at all.
   */
  focusLight: boolean;
  /** Which face sets headlines. `serif` is study C's whole argument. */
  display: "sans" | "serif";
  /** Set on the direction chosen at review, so a reader knows which won. */
  chosen?: true;
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
    skin: "glass",
    focusLight: false,
    display: "sans",
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
    skin: "panel",
    focusLight: true,
    display: "sans",
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
    skin: "rule",
    focusLight: false,
    display: "serif",
  },
  {
    id: "chosen",
    scenario: "study-chosen",
    name: "Precision & Light, in Mint",
    thesis:
      "The direction picked at review: B's material, A's typeface, and the brand colour Vibe already has.",
    material:
      "Study B's surfaces unchanged — opaque panels, bright hairlines, tight corners, glass kept for chrome, one light band on the focused card. What moved is the accent and the face. Mint is far more saturated than signal blue and sits on a cool ground here rather than a tinted one, which is a combination none of the first three showed.",
    accent: "#00e5a0",
    accentName: "Mint — unchanged",
    typeface: "Geist",
    skin: "panel",
    focusLight: true,
    display: "sans",
    chosen: true,
  },
] as const;

/** The label-treatment comparison, rendered in the chosen direction. */
export const LABELS_SCENARIO = "study-labels";

/** The identifier-face comparison, rendered in the chosen direction. */
export const MONO_SCENARIO = "study-mono";

/** The inline-action comparison, rendered in the chosen direction. */
export const ACTIONS_SCENARIO = "study-actions";

/** The icon-led follow-up to it. */
export const ICON_ACTIONS_SCENARIO = "study-icon-actions";

/** Why the dismiss mark reads as drawn — weight and cut, at real sizes. */
export const MARK_SCENARIO = "study-mark";

/** The container around the mark, which is what makes it read as a control. */
export const DISMISS_SCENARIO = "study-dismiss";

/** The same principles for the controls that live inside text. */
export const INLINE_SCENARIO = "study-inline";

/** The block that opens — "see more", "More context", "Technical details". */
export const DISCLOSURE_SCENARIO = "study-disclosure";

/** What the action work left open: the links, and how loud a delete is. */
export const LINKS_SCENARIO = "study-links";

/** What lies behind the glass — the ground the product does not yet have. */
export const BACKGROUND_SCENARIO = "study-background";

/** The Credit: a mark for it, and a price that looks like money. */
export const CREDITS_SCENARIO = "study-credits";

export function studyByScenario(scenario: string): Study | null {
  return STUDIES.find((study) => study.scenario === scenario) ?? null;
}

export function isStudyScenario(scenario: string): boolean {
  return studyByScenario(scenario) !== null;
}

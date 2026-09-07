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

export function studyByScenario(scenario: string): Study | null {
  return STUDIES.find((study) => study.scenario === scenario) ?? null;
}

export function isStudyScenario(scenario: string): boolean {
  return studyByScenario(scenario) !== null;
}

/**
 * The composition studies, rendered in the chosen direction.
 *
 * A separate axis from `STUDIES`: those vary material and hold the composition
 * fixed, these do the reverse. Kept out of `STUDIES` so the direction gallery
 * stays a comparison of four materials and does not silently become five.
 */
export const COMPOSITION_SCENARIO = "study-composition";
export const COMPOSITION_SETTLED_SCENARIO = "study-composition-settled";
/** Five candidates at once — the case that says whether the band's columns balance. */
export const COMPOSITION_DENSE_SCENARIO = "study-composition-dense";

/**
 * The voice studies: the same ranking and the same material, said by Nova.
 *
 * A third axis after material and rank, and the one the product's own two
 * projections already disagreed about — `home-view.ts` chose the composition
 * over `buildNovaFeed`'s transcript, and onboarding kept the transcript. These
 * render Home in the voice onboarding uses.
 */
export const VOICE_SCENARIO = "study-voice";
export const VOICE_SETTLED_SCENARIO = "study-voice-settled";
export const VOICE_DENSE_SCENARIO = "study-voice-dense";

export function isVoiceScenario(scenario: string): boolean {
  return (
    scenario === VOICE_SCENARIO ||
    scenario === VOICE_SETTLED_SCENARIO ||
    scenario === VOICE_DENSE_SCENARIO
  );
}

export function isCompositionScenario(scenario: string): boolean {
  return (
    scenario === COMPOSITION_SCENARIO ||
    scenario === COMPOSITION_SETTLED_SCENARIO ||
    scenario === COMPOSITION_DENSE_SCENARIO
  );
}

/** The direction every composition study is drawn in. */
export function chosenStudy(): Study {
  const study = STUDIES.find((candidate) => candidate.chosen);
  if (!study) throw new Error("no chosen study is marked in STUDIES");
  return study;
}

/**
 * The chat studies: Home in the shape a founder has already learned.
 *
 * A fourth axis, and the one the user named as the core idea of Nova's UI —
 * that a founder should see they are being spoken to. Two scenarios, because
 * what a press produces is half the argument and cannot be seen in a still of
 * the resting state.
 */
export const CHAT_SCENARIO = "study-chat";
export const CHAT_ANSWERED_SCENARIO = "study-chat-answered";

export function isChatScenario(scenario: string): boolean {
  return scenario === CHAT_SCENARIO || scenario === CHAT_ANSWERED_SCENARIO;
}

/**
 * The console studies: Nova as a standing presence rather than a speaker in
 * the thread. Two scenarios, because the box's whole argument is the present
 * tense and an idle project has none — and a study that only ever showed the
 * working state would be hiding the case where the box has least to say.
 */
export const CONSOLE_SCENARIO = "study-console";
export const CONSOLE_IDLE_SCENARIO = "study-console-idle";

export function isConsoleScenario(scenario: string): boolean {
  return scenario === CONSOLE_SCENARIO || scenario === CONSOLE_IDLE_SCENARIO;
}

/**
 * The moments gallery: every candidate the domain can raise, on one page.
 *
 * Not a layout study — an index to work through. The four layout studies each
 * show one moment, and a shape that only ever met a change awaiting review
 * will meet the other twenty in production.
 */
export const MOMENTS_SCENARIO = "study-moments";

/**
 * The blocked tier, designed one moment at a time.
 *
 * The gallery's own finding: ten different situations, one appearance. This
 * is the first tier worked through individually.
 */
export const BLOCKED_SCENARIO = "study-blocked";

/** The Move element sheet: one control, three designs, four states each. */
export const MOVE_SCENARIO = "study-move";

/**
 * The Bubble element sheet: four registers, tested with hue removed.
 *
 * It replaced a Line sheet that put the register inside the sentence. That
 * scenario is gone rather than kept beside this one: two element sheets for
 * one element is how a lab stops being an answer to anything.
 */
export const BUBBLE_SCENARIO = "study-bubble";

/**
 * The wireframe, assembled from the elements.
 *
 * Two scenarios, because availability is an operator switch and the state that
 * matters is the one nobody sees in normal use — a study that only ever showed
 * "Online" would be shipping an offline notice nobody looked at.
 */
export const WIREFRAME_SCENARIO = "study-wireframe";

/**
 * The rail, in the states it can be in.
 *
 * Mounts the product's own `NovaRail` with fixtures, because the rail is
 * otherwise only visible to a founder whose project happens to be in the state
 * you wanted to look at.
 */
export const RAIL_SCENARIO = "study-rail";

/** The Render Block element sheet: in flight, settled, and unscorable. */
export const BLOCK_SCENARIO = "study-block";

/**
 * The opening: the first time a founder ever meets Nova.
 *
 * Two scenarios, because the sequence and what follows it are different
 * questions. The first is a choreography and can only be judged running; the
 * second is the one thing she asks before the product starts, and is a still.
 */
export const OPENING_SCENARIO = "study-opening";
export const OPENING_WALKTHROUGH_SCENARIO = "study-opening-walkthrough";
export const WIREFRAME_OFFLINE_SCENARIO = "study-wireframe-offline";

export function isWireframeScenario(scenario: string): boolean {
  return scenario === WIREFRAME_SCENARIO || scenario === WIREFRAME_OFFLINE_SCENARIO;
}

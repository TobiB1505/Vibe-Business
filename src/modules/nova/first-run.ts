import type { OnboardingState } from "../onboarding/state";
import { NOVA_ACTION_META } from "./actions";
import type { NovaEntry } from "./feed";

/**
 * The two things Nova says before the product starts talking about itself.
 *
 * ## Why this is not in `deriveOnboardingState`
 *
 * Because nothing about setup changed. `deriveOnboardingState` still owns the
 * ten states, their reconciliation and their tests, and this reads its answer
 * rather than replacing it — §O.1's two lanes, and the invariant §L Slice 3
 * states outright: `deriveOnboardingState` untouched.
 *
 * What sits here is the pair of positions that belong to Nova alone. They are
 * not states of the *project*: a project whose repository is connected and
 * whose scan has not begun is in exactly one onboarding state whether or not
 * Nova has said hello. The introduction is a fact about the founder's
 * experience, and it lives in the two columns this slice added.
 *
 * ## Why only two of the four positions render as a feed
 *
 * §L Slice 3 says positions 1–4. Two of them keep their existing screens, and
 * that is a limit of the feed rather than a shortcut: position 1 carries a
 * repository picker and position 4 a URL field, and Nova's components have no
 * text input by design (§M — nothing in this product reads free text into a
 * decision outside two allowlisted, bounded fields). A feed that grew one to
 * render an onboarding step would be the third.
 *
 * So Nova introduces herself and offers to explain the loop; the two screens
 * that need input stay as they are, and Slice 4 takes the scan and the reveal.
 */

export const NOVA_WORKFLOW_STATUSES = [
  /** The founder has not been offered the explanation yet. */
  "unseen",
  /** They asked for it. */
  "explained",
  /**
   * They were asked and chose to get on with it.
   *
   * A value rather than an absence, for the reason `no_live_site_yet` is one
   * on this same table: "declined" and "not yet asked" are different facts
   * about a person, and a null cannot hold both.
   */
  "skipped",
] as const;

export type NovaWorkflowStatus = (typeof NOVA_WORKFLOW_STATUSES)[number];

export type NovaFirstRunFacts = {
  /** `deriveOnboardingState`'s answer, unchanged and not re-derived here. */
  onboardingState: OnboardingState;
  novaIntroducedAt: string | null;
  novaWorkflowStatus: NovaWorkflowStatus;
};

export type NovaFirstRunPosition =
  /** Nova has nothing to say yet: there is no product to talk about. */
  | "before_source"
  /** Nova has not introduced herself for this project. */
  | "introduce"
  /** Introduced, and the founder has not been offered the walkthrough. */
  | "explain_workflow"
  /** Nova's first run is behind us; onboarding's own screens continue. */
  | "handoff";

/**
 * Where the first run has got to.
 *
 * A cascade, like `deriveOnboardingState`, because this half genuinely is
 * linear: an introduction precedes the offer to explain, and both precede
 * everything else. The ranking in `focus.ts` is for afterwards, when a project
 * can be several things at once.
 *
 * `before_source` comes first and not last. Introducing Nova over an empty
 * project would be Nova saying hello about nothing — there is no repository,
 * no product and nothing she could describe, and the founder has one thing to
 * do that Nova cannot do for them.
 */
export function deriveNovaFirstRun(facts: NovaFirstRunFacts): NovaFirstRunPosition {
  if (facts.onboardingState === "connect_source") return "before_source";
  if (facts.novaIntroducedAt === null) return "introduce";
  if (facts.novaWorkflowStatus === "unseen") return "explain_workflow";
  return "handoff";
}

/**
 * What Nova says at each of her own two positions.
 *
 * Static copy in a table, held to the same rules as every other sentence she
 * has: no promise, no figure, nothing called safe or live, and no claim about
 * work nobody has done yet. The introduction in particular is where a product
 * is most tempted to say what it *will* achieve, and Nova describes only what
 * she does.
 */
const INTRODUCTION = [
  "I read your code and your product, work out what is holding the business back, and then I build the changes myself.",
  "You stay in charge of what ships. Nothing reaches your default branch until you have looked at it and said yes.",
] as const;

const WORKFLOW_OFFER =
  "Before we start: I can walk you through how a change gets from an idea to your default branch.";

/**
 * The walkthrough itself.
 *
 * It exists because the control that records `explained` has to explain
 * something. A button that wrote the column and showed nothing would make the
 * column false in the other direction from the name §O.5 rejected — recording
 * an explanation that did not happen rather than one that did.
 *
 * Four sentences, one per thing that actually occurs, in the order it occurs.
 * None of them promises an outcome and none says a change is finished: the
 * last one is the guarantee Vibe genuinely makes, which is that the founder
 * decides.
 */
const WORKFLOW_STEPS = [
  "First I read your code and, if you have one, your live product, and tell you what I understood.",
  "Then I look at the business around it and say what is holding it back, worst thing first.",
  "When you pick something, I plan it, build it on a branch of its own, and check that the project still builds.",
  "Then you look at what I did. Nothing reaches your default branch until you say so.",
] as const;

/**
 * The feed for a first-run position, or nothing when the screen is not Nova's.
 *
 * `before_source` and `handoff` return an empty feed rather than a sentence,
 * and the route reads that as "render what you rendered before". An entry
 * saying "Nova has nothing to say" would be a screen element made of an
 * absence.
 */
export function buildNovaFirstRunFeed(position: NovaFirstRunPosition): NovaEntry[] {
  if (position === "introduce") {
    return [
      ...INTRODUCTION.map((text, index) => ({
        kind: "nova.message" as const,
        id: `first-run:introduce:${index}`,
        text,
        emphasis: "primary" as const,
      })),
      {
        kind: "nova.choice",
        id: "first-run:introduce:choice",
        prompt: "",
        options: [
          {
            actionId: "nova.continue_introduction",
            control: NOVA_ACTION_META["nova.continue_introduction"].control,
            label: NOVA_ACTION_META["nova.continue_introduction"].label,
            price: null,
            consequential: false,
            requiresConfirmation: false,
            confirmationNote: null,
            subject: { kind: "project" },
          },
        ],
      },
    ];
  }

  if (position === "explain_workflow") {
    return [
      {
        kind: "nova.message",
        id: "first-run:explain:message",
        text: WORKFLOW_OFFER,
        emphasis: "primary",
      },
      {
        kind: "nova.choice",
        id: "first-run:explain:choice",
        prompt: "",
        options: (["nova.explain_workflow", "nova.skip_workflow"] as const).map((actionId) => ({
          actionId,
          control: NOVA_ACTION_META[actionId].control,
          label: NOVA_ACTION_META[actionId].label,
          price: null,
          consequential: false,
          requiresConfirmation: false,
          confirmationNote: null,
          subject: { kind: "project" as const },
        })),
      },
    ];
  }

  return [];
}

/**
 * What the founder sees after asking to be shown.
 *
 * Not a position: it is what one of `explain_workflow`'s two controls reveals,
 * and by the time the write behind it lands the derived position is already
 * `handoff`. Deriving it from a column would have meant a third status value
 * for a screen the founder is looking at right now.
 */
export function buildNovaWorkflowExplanation(): NovaEntry[] {
  return WORKFLOW_STEPS.map((text, index) => ({
    kind: "nova.message" as const,
    id: `first-run:walkthrough:${index}`,
    text,
    emphasis: index === 0 ? ("primary" as const) : ("aside" as const),
  }));
}

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
 * ## `before_source` was here, and it was the wrong way round
 *
 * It short-circuited on `connect_source` and returned nothing, on the argument
 * that "introducing Nova over an empty project would be Nova saying hello
 * about nothing — there is no repository, no product and nothing she could
 * describe".
 *
 * That reads the introduction as being *about the project*, and it is not.
 * It is about her: what she does, and that nothing reaches a default branch
 * without the founder saying yes. Neither sentence needs a repository, and the
 * first thing the old order did was ask a stranger to connect their code
 * before telling them who was asking. The walkthrough is the same: *how a
 * change gets from an idea to your default branch* is precisely what somebody
 * wants before handing over the repository, not after.
 *
 * The opening's choreography settles it. The mark assembles, travels into the
 * status row and the room is drawn around it — Nova building the environment
 * the whole of setup then happens in. That can only be first.
 *
 * So the cascade is now purely about her own two positions, and
 * `onboardingState` no longer gates them. It stays on the facts because
 * `handoff` is still the answer for a project that has met her.
 */
export function deriveNovaFirstRun(facts: NovaFirstRunFacts): NovaFirstRunPosition {
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
 *
 * `feed.test.ts` sweeps these now. It did not, and the gap was the shape its
 * own docblock warns about: the rules were a property of a *sweep* rather than
 * of Nova, so the copy a founder meets first — before any of the twenty-one
 * moments and before any onboarding state — was the one part of her voice
 * nothing checked.
 */

/**
 * Hello, by name where there is one.
 *
 * ## Why the name is a parameter and not a lookup
 *
 * Because `identity-view.ts` holds the rule this has to obey: **never invent a
 * name.** Nothing in this codebase stores one. There are exactly two things a
 * founder may be called — the GitHub login they authenticated with, which is a
 * name they chose, and their email address, which is an address. An address is
 * not shortened into a name here: "tobivlog@outlook.de" does not become
 * "Tobi", because that is a guess about a person presented as a fact.
 *
 * So a caller passes a login or it passes null, and the greeting has two
 * forms. The nameless one is not a degraded version — it is the same warmth
 * without a claim in it.
 */
export function novaGreeting(name: string | null): string {
  return name
    ? `Hi ${name} — I am Nova. I will be the one working on your product with you, and I will walk you through the setup now.`
    : "Hi — I am Nova. I will be the one working on your product with you, and I will walk you through the setup now.";
}

/** What she says after hello, and before anything is asked of anybody. */
const INTRODUCTION = [
  "After that: I read your code and your live product, work out what is holding the business back, and then I build the changes myself.",
  "You stay in charge of what ships. Nothing reaches your default branch until you have looked at it and said yes.",
] as const;

/**
 * The question, and the only one asked before setup begins.
 *
 * Two real answers, and neither is a dismissal: getting on with it is a
 * choice a person made, which is why `skipped` is a value on the status table
 * rather than an absence.
 */
const WORKFLOW_OFFER =
  "Before we start — shall we get straight to it, or would you like me to show you how I work first?";

/**
 * How she works, for somebody who asked.
 *
 * ## Why this is about the interface and not only about the pipeline
 *
 * It used to be four sentences describing what happens to a change: read,
 * judge, build, review. All true, and all of it answers a question nobody had
 * yet. The thing a person actually does not know on meeting this screen is
 * *what kind of thing am I talking to* — and the answer is unusual enough to
 * be worth saying outright. She is not a chat box. There is nothing to type.
 * She proposes one thing and a person presses it or does not.
 *
 * So the interaction comes first and the pipeline second, and the block that
 * follows shows the shape rather than describing it again.
 */
const WORKFLOW_STEPS = [
  "I am not a chat box. There is nothing here to type, and I will never ask you to write out what you want.",
  "I say one thing at a time, and under it I put the one thing I think is worth doing next. You press it, or you do not — that is the whole of it.",
  "Anything that costs money carries its price inside the button, before you press. Reading, looking and changing your mind are free.",
  "And when I have built something, you see it before it goes anywhere. Nothing reaches your default branch until you say so.",
] as const;

/** The line that hands over to the example, so the block is not unannounced. */
const WORKFLOW_EXAMPLE_LEAD = "Here is what that looks like.";

/**
 * The feed for a first-run position, or nothing when the screen is not Nova's.
 *
 * `handoff` returns an empty feed rather than a sentence, and the route reads
 * that as "render what you rendered before". An entry saying "Nova has nothing
 * to say" would be a screen element made of an absence.
 */
export function buildNovaFirstRunFeed(
  position: NovaFirstRunPosition,
  /**
   * What to call the founder, or null when nothing here knows.
   *
   * Only the introduction uses it, and only in its first sentence. Defaulted
   * so every caller that has no identity to hand — the lab, the studies, the
   * tests about ordering — gets the nameless greeting rather than a required
   * argument they would have to invent a value for.
   */
  name: string | null = null,
): NovaEntry[] {
  if (position === "introduce") {
    return [
      {
        kind: "nova.message" as const,
        id: "first-run:introduce:hello",
        text: novaGreeting(name),
        emphasis: "primary" as const,
      },
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
 * on the same screen, without a write. Deriving it from a column would have
 * meant a third status value for a screen the founder is looking at right now
 * — and the write it *would* have needed is exactly what used to replace this
 * thread with the next setup step the instant somebody asked to see it.
 *
 * Four sentences about how she works, the line that hands over to the example,
 * and the press that records having been shown it.
 */
export function buildNovaWorkflowExplanation(): NovaEntry[] {
  return [
    ...WORKFLOW_STEPS.map((text, index) => ({
      kind: "nova.message" as const,
      id: `first-run:walkthrough:${index}`,
      text,
      emphasis: index === 0 ? ("primary" as const) : ("aside" as const),
    })),
    /*
     * Last, because the block it announces is rendered under the sentences and
     * a lead that arrived anywhere else would be pointing at nothing.
     */
    {
      kind: "nova.message" as const,
      id: "first-run:walkthrough:example",
      text: WORKFLOW_EXAMPLE_LEAD,
      emphasis: "primary" as const,
    },
    /*
     * And the press that records `explained`, at the bottom of the thing it
     * records having shown. The catalog owns the verb, as everywhere else — a
     * label written here would be a button saying one thing and writing
     * another.
     */
    {
      kind: "nova.choice" as const,
      id: "first-run:walkthrough:choice",
      prompt: "",
      options: [
        {
          actionId: "nova.begin_setup" as const,
          control: NOVA_ACTION_META["nova.begin_setup"].control,
          label: NOVA_ACTION_META["nova.begin_setup"].label,
          price: null,
          consequential: false,
          requiresConfirmation: false,
          confirmationNote: null,
          subject: { kind: "project" as const },
        },
      ],
    },
  ];
}

import type { OnboardingState } from "../onboarding/state";
import { NOVA_ACTION_META } from "./actions";
import type { NovaEntry } from "./feed";

/**
 * The two things Nova says before the product starts talking about itself.
 *
 * ## Why this is not in `deriveOnboardingState`
 *
 * Because nothing about setup changed. `deriveOnboardingState` still owns the
 * eleven states, their reconciliation and their tests, and this reads its answer
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
    ? `Hi ${name} — I'm Nova. I'll be working on your product with you.`
    : "Hi — I'm Nova. I'll be working on your product with you.";
}

/**
 * What she says after hello, and before anything is asked of anybody.
 *
 * Two sentences rather than a description of the pipeline. The first says what
 * she will do next; the second says what she can do, and closes on the only
 * promise Vibe actually makes.
 */
const INTRODUCTION = [
  "I'll get to know what you built, look at the business around it, and work out what's worth improving first.",
  "When there's something I can build for you, I can do that too. You'll always see the result before anything reaches your default branch.",
] as const;

/**
 * The question, and the only one asked before setup begins.
 *
 * Two real answers, and neither is a dismissal: getting on with it is a
 * choice a person made, which is why `skipped` is a value on the status table
 * rather than an absence.
 */
const WORKFLOW_OFFER =
  "Before we start — want to get straight to your product, or should I show you how working with me works first?";

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
  "One thing before we start.",
  "You don't need to write prompts or work out what to ask me. I'll guide us through this.",
  "I'll show you what I'm looking at, tell you what I think matters, and give you one clear next step at a time.",
  "You decide what we do. And if something costs Credits, you'll see the price before you start it — never afterwards.",
  "If I build something, you review it before it goes anywhere.",
] as const;

/**
 * The line that hands over to the example, so the block is not unannounced.
 *
 * The component finds it by id and puts the block underneath, which is why the
 * id is exported rather than left as a string two files know about.
 */
export const WORKFLOW_EXAMPLE_ID = "first-run:walkthrough:example";

const WORKFLOW_EXAMPLE_LEAD =
  "Here's a quick example. It's only to show you how working with me feels — it isn't about your product.";

/**
 * And the line under the example, which is the seam.
 *
 * Everything above it is Nova describing herself; everything after it is her
 * working. Saying so out loud is what stops the example being mistaken for the
 * beginning of the real thing.
 */
const WORKFLOW_HANDOVER = "That's it. From here on, everything you see is about your product.";

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
     * The lead, and the block goes under it. `NovaFirstRun` finds this entry
     * by id and inserts the example there rather than at the end, because the
     * sentence after it is about what happens *next* — a handover printed
     * above the thing it hands over from would read as part of the example.
     */
    {
      kind: "nova.message" as const,
      id: WORKFLOW_EXAMPLE_ID,
      text: WORKFLOW_EXAMPLE_LEAD,
      emphasis: "primary" as const,
    },
    {
      kind: "nova.message" as const,
      id: "first-run:walkthrough:handover",
      text: WORKFLOW_HANDOVER,
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

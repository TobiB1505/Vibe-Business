import type { AuditCreditGate } from "../business-audit/entitlement";
import type { OnboardingState } from "../onboarding/state";
import { NOVA_ACTION_META } from "./actions";
import type { NovaActionId } from "./actions";
import type { NovaChoiceOption, NovaEntry } from "./feed";
import type { NovaFocusTier } from "./focus";

/**
 * The onboarding lane, once Nova's own two screens are behind us.
 *
 * `first-run.ts` covers the introduction; this covers the two positions where
 * Nova narrates work the product was already doing — reading the founder's
 * product, and showing them what it understood. The screens themselves are the
 * existing ones (`ProductScanExperience`, and the reveal card lifted out of the
 * onboarding page): Nova says the sentence above them and owns the control
 * below, and re-implements neither.
 *
 * `deriveOnboardingState` is still the authority on which position this is.
 * Nothing here re-derives it.
 */

export type NovaOnboardingPosition =
  /** Vibe is reading the product. Nothing is asked of the founder. */
  | "scanning"
  /** Vibe has read it, and the founder has not said whether it is right. */
  | "reveal"
  /** Some other onboarding state; Nova has nothing to add to it yet. */
  | "elsewhere";

export function deriveNovaOnboarding(state: OnboardingState): NovaOnboardingPosition {
  if (state === "product_scanning") return "scanning";
  if (state === "product_reveal") return "reveal";
  return "elsewhere";
}

/**
 * Which controls the reveal offers, and why there are two shapes (§O.3).
 *
 * The founder has been shown what Vibe read and is being asked one thing: *is
 * this right?* What may honestly ride along with the answer depends entirely on
 * what the next audit costs.
 *
 * **Free** — one control, and it says where it leads. Splitting a free
 * continuation into *"is this right?"* → *"shall I audit it?"* is two presses
 * for one decision, and it is the friction Nova exists to remove.
 *
 * **Priced** — confirming and auditing are two decisions and stay two presses.
 * Bundling here would make a paid operation the side effect of a question about
 * accuracy, which is precisely what rule 60 forbids; the audit is then offered
 * afterwards, with its price beside it.
 *
 * The branch needs no new state: `AuditCreditGate` already answers it
 * everywhere else in the product, and `not_applicable` is exactly "nothing is
 * owed" — the included first audit, or an audit Vibe owes as a refresh.
 */
export function novaRevealControls(
  gate: AuditCreditGate,
  signedInStepNext = false,
): NovaActionId[] {
  return novaRevealBundlesAudit(gate, signedInStepNext)
    ? ["nova.confirm_product_and_audit"]
    : ["nova.confirm_product"];
}

/**
 * Whether the audit rides along with the confirmation, for the copy above it.
 *
 * `signedInStepNext` is the second reason not to bundle, and it is the
 * argument above read the other way round. Bundling is right when confirming
 * and auditing are one decision with two presses; it is wrong the moment
 * something real stands between them. The signed-in read does: a control
 * saying *yes, and audit it* would start the audit over the founder's answer
 * to a question they had not been asked yet — and an audit that runs before
 * the signed-in read is the one thing this whole step exists to avoid.
 */
export function novaRevealBundlesAudit(gate: AuditCreditGate, signedInStepNext = false): boolean {
  return gate.kind === "not_applicable" && !signedInStepNext;
}

/**
 * What Nova says at each point of the setup, in her own voice.
 *
 * ## Why this is total over `OnboardingState`
 *
 * Because onboarding already has a ranking and nobody was reading it as one.
 * `deriveOnboardingState` is the same shape as `deriveNovaFocus` — pure, facts
 * in, one state out, reconciled from canonical records so a run finishing while
 * the founder is away cannot strand them on an obsolete screen. Ten states, in
 * priority order. What it never had was a sentence per state, so the page
 * rendered ten sections of its own chrome and Nova appeared beside two of them.
 *
 * A total record means an eleventh state fails the build here until somebody
 * decides what Nova says about it — the same guarantee `BLOCK_FOR_MOMENT` gives
 * the twenty-one moments, which is what stopped a new moment rendering nothing
 * at all.
 *
 * ## The rules these are held to
 *
 * The five `feed.test.ts` runs over every candidate sentence, and it runs them
 * over these now too: no claimed cause, no promise to deploy or ship or
 * publish, nothing called safe or correct or finished, no figure — a number in
 * a sentence is a second copy of something the interface renders from state —
 * and long enough to say something.
 *
 * ## `complete`, which is the handover
 *
 * It is the one state whose sentence is not about setup. The page redirects to
 * the project the moment it is reached, so this is the last thing Nova says
 * before Home's own ranking takes over the same thread. Written here rather
 * than left blank because a total record with a hole in it is a record that
 * stopped being total, and because the sentence is the seam: onboarding ends
 * by saying what happens next, and Home continues.
 */
export const NOVA_ONBOARDING_MESSAGE: Record<OnboardingState, string> = {
  connect_source:
    "Let's start with the product itself. Connect the repository and I'll begin learning how it's put together.",
  add_live_product:
    "Now I want to see the product the way a customer does. Give me the live address and I'll hold what's there against what I find in the code.",
  product_scanning:
    "I'm getting to know your product now. I'll read through the code and the live experience — you don't need to stay here while I do it.",
  product_reveal:
    "I've got a good picture of what you built. Here's how I understand it — take a look, and if I've misunderstood anything important, tell me before I go further.",
  add_signed_in_product:
    "I've read your code and the pages anyone can reach. What I haven't seen is your product from the inside, signed in — and for most products that's where nearly all of it is.",
  audit_preparing:
    "Good. Now I'm going to look at the business around the product — what's working for it, what's in its way, and what deserves attention first.",
  audit_needs_user:
    "I need one thing from you before I can keep going. It's something I can't reliably learn from the product itself.",
  audit_running:
    "That's enough for me to work with. I'm going through the business now, and I'll come back when I know what I'd start with.",
  audit_reveal:
    "I found a few things worth your attention. One of them stands out — if this were my product, that's where I'd start.",
  first_move:
    "This is the first move I'd make. It won't settle everything, and it doesn't need to — it's the best place to start from where the product is today.",
  complete:
    "We're set up. From here I keep track of the product with you — what matters, what changed, and what I think is worth doing next. Whenever you come back, I'll pick up where we left off.",
};

/**
 * The second true thing, where there is one.
 *
 * ## Why most of these are null
 *
 * Because the block below usually says it better. A scan narrates its own
 * stages, the reveal asks its own question, the audit's reading is the reading
 * — and Nova adding a line about any of them would be the caption problem this
 * surface keeps removing.
 *
 * The ones that are not null are where something is true that no component on
 * screen can state: what GitHub is about to ask for, what a live product buys
 * that the code alone cannot, what the audit is left judging without a
 * signed-in read, and that setup is behind us either way at the first move.
 * The first two were already written on the page, in its own prose, above the
 * control. They moved here rather than being rewritten, because the sentence
 * was reviewed once and the point of this table is that there is one copy
 * of it.
 *
 * Held to the same five rules as the messages, and swept with them.
 */
export const NOVA_ONBOARDING_DETAIL: Record<OnboardingState, string | null> = {
  connect_source:
    "GitHub will ask which repositories I can access. You stay in control of that — I only ever get the ones you pick.",
  add_live_product:
    "It tells me not just how the product is built, but what people actually run into.",

  /*
    What the audit does without it, which is the one thing on this screen no
    component can state. The block says what a signed-in read is and what it
    costs; the panel says Vibe stores neither the password nor the session.
    Neither of them knows what happens next if the founder says no — and that
    is the fact the decision actually turns on.

    It is `evidence-v3.ts`'s own absent-source line, in her voice: an audit
    that runs with no authenticated read records that anything only visible to
    signed-in users is unobserved. She is describing a consequence Vibe
    actually writes, not arguing for the feature.
  */
  add_signed_in_product:
    "If we go into the audit without it, I have to judge the business with everything behind your login unread — and I'd rather not guess at that part.",

  /* The scan reports its own stages, from rows it writes as it goes. */
  product_scanning: null,
  /* The reveal states what was understood and asks its own question. */
  product_reveal: null,
  /* Nothing is owed while Vibe works, and nothing is known yet. */
  audit_preparing: null,
  audit_running: null,
  /* The panel carries the question and its options. */
  audit_needs_user: null,
  /* The reading is the second thing, and it is a block rather than a line. */
  audit_reveal: null,
  /*
   * The reassurance the page carried at the foot of this state, in its own
   * words: setup is done whether or not the founder starts the Move. It is the
   * one line that has to survive the chrome being removed, because it is what
   * makes the control below a choice rather than the last gate of setup.
   */
  first_move:
    "Your setup is behind us either way — this is a choice, not the last gate. And you'll see anything I build before it goes anywhere.",
  /* The handover says itself. */
  complete: null,
};

/**
 * Which register each setup state is in.
 *
 * ## Why the environment needs this at all
 *
 * Because Nova's mark, her status word and the contour of her bubble are all
 * derived from a tier, and setup had none — it had a four-step progress rail
 * instead, which says how far along you are and nothing about whose turn it
 * is. Those are different facts, and only the second one changes what she
 * looks like.
 *
 * So the same vocabulary the twenty-one moments use: `blocked` is nothing Vibe
 * can do without a person, `decision` is the founder's turn, `ready` is Vibe
 * working, `setup` is the state before there is anything to work on.
 *
 * ## Why `product_reveal` is a decision and `audit_running` is not
 *
 * The reveal asks a question and waits — the mark listens. A run in flight is
 * Vibe working and the mark turns, which is honest because an operation row
 * says so. Nothing here asserts activity: `novaPresenceState` still takes the
 * live operation's phase, and this only says what the state is *about* when
 * nothing is running.
 */
export const NOVA_ONBOARDING_TIER: Record<OnboardingState, NovaFocusTier> = {
  /* Vibe cannot look at anything until somebody connects something. */
  connect_source: "setup",
  add_live_product: "decision",

  /* Vibe's turn. The mark turns only while the operation row says it runs. */
  product_scanning: "ready",
  audit_preparing: "ready",
  audit_running: "ready",

  /* The founder's turn, and the mark listens. */
  product_reveal: "decision",
  add_signed_in_product: "decision",
  audit_needs_user: "decision",
  audit_reveal: "decision",
  first_move: "decision",

  /* Setup is behind us; the next screen has its own ranking. */
  complete: "settled",
};

const SCANNING_MESSAGE = NOVA_ONBOARDING_MESSAGE.product_scanning;

const REVEAL_MESSAGE = NOVA_ONBOARDING_MESSAGE.product_reveal;

function option(actionId: NovaActionId): NovaChoiceOption {
  const meta = NOVA_ACTION_META[actionId];
  return {
    actionId,
    control: meta.control,
    label: meta.label,
    price: meta.price,
    consequential: meta.consequential,
    requiresConfirmation: meta.requiresConfirmation,
    confirmationNote: meta.confirmationNote ?? null,
    subject: { kind: "project" },
  };
}

/**
 * What Nova says while the scan runs.
 *
 * A sentence and nothing else. The progress itself belongs to
 * `ProductScanExperience`, which already renders named stages from
 * `product_scan_events` — and there is no control, because there is nothing
 * for the founder to decide while Vibe reads.
 */
export function buildNovaScanFeed(): NovaEntry[] {
  return [
    {
      kind: "nova.message",
      id: "onboarding:scanning",
      text: SCANNING_MESSAGE,
      emphasis: "primary",
    },
  ];
}

/**
 * What Nova says at the reveal, and the one control under it.
 *
 * The card showing *what* was understood is the existing one; this is the
 * sentence above it and the answer below it. Correcting is not an option here
 * for the same reason a question is not a choice in `feed.ts`: the correction
 * form is a bounded, allowlisted set of fields that its own component owns,
 * and Nova restating them would be a second copy of the one place that knows
 * which fields are editable.
 */
export function buildNovaRevealFeed(gate: AuditCreditGate): NovaEntry[] {
  return [
    {
      kind: "nova.message",
      id: "onboarding:reveal",
      text: REVEAL_MESSAGE,
      emphasis: "primary",
    },
    {
      kind: "nova.choice",
      id: "onboarding:reveal:choice",
      prompt: "",
      options: novaRevealControls(gate).map(option),
    },
  ];
}

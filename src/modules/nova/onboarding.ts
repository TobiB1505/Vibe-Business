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
export function novaRevealControls(gate: AuditCreditGate): NovaActionId[] {
  return gate.kind === "not_applicable"
    ? ["nova.confirm_product_and_audit"]
    : ["nova.confirm_product"];
}

/** Whether the audit rides along with the confirmation, for the copy above it. */
export function novaRevealBundlesAudit(gate: AuditCreditGate): boolean {
  return gate.kind === "not_applicable";
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
    "We start with your code. Show me the repository your product lives in and I can begin reading it.",
  add_live_product:
    "Now — where does somebody actually find your product? Give me the address and I will look at what a visitor sees.",
  product_scanning:
    "I am reading through your product now. You do not have to wait here; I will still be at it when you come back.",
  product_reveal:
    "Here is what I understood about your product. Have a look — if I have any of it wrong, tell me and I will put it right.",
  audit_preparing: "Right. I am getting ready to look at the business around your product.",
  audit_needs_user:
    "I have stopped part-way through. There is something only you can tell me before I carry on.",
  audit_running:
    "I am working through your business now, area by area. Nothing here needs you until I am done.",
  audit_reveal:
    "Here is what I found. I have put the thing I would deal with first at the top of it.",
  first_move: "So this is the first thing I would actually do about it, if you want me to.",
  complete:
    "That is your setup behind us. From here I tell you what matters as it changes, and you will find me here whenever you come back.",
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
 * The two that are not null are the two where something is true that no
 * component on screen can state: what GitHub is about to ask for, and what a
 * live product buys that the code alone cannot. Both were already written on
 * the page, in its own prose, above the control. They move here rather than
 * being rewritten, because the sentence was reviewed once and the point of
 * this table is that there is one copy of it.
 *
 * Held to the same five rules as the messages, and swept with them.
 */
export const NOVA_ONBOARDING_DETAIL: Record<OnboardingState, string | null> = {
  connect_source:
    "GitHub will ask which repositories I may see. That choice is entirely yours, and I only ever get the ones you pick.",
  add_live_product:
    "It lets me hold what the code says against what somebody out there can actually reach.",

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
    "Your setup is behind us either way — this is a choice, not the last gate. Your workspace is where everything lives from here.",
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

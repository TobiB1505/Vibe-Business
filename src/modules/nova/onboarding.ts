import type { AuditCreditGate } from "../business-audit/entitlement";
import type { OnboardingState } from "../onboarding/state";
import { NOVA_ACTION_META } from "./actions";
import type { NovaActionId } from "./actions";
import type { NovaChoiceOption, NovaEntry } from "./feed";

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
  connect_source: "I cannot read anything yet. Point me at the repository your product lives in.",
  add_live_product:
    "Tell me where a visitor finds your product, and I will read what they actually see.",
  product_scanning: "I am reading your product now.",
  product_reveal: "Here is what I understood about your product. Tell me if I have it wrong.",
  audit_preparing: "I am getting ready to look at your business.",
  audit_needs_user: "I stopped part-way through, and I need something from you before I go on.",
  audit_running: "I am working through your business now.",
  audit_reveal: "Here is what I found, and where I would start.",
  first_move: "This is the first thing I would do about it.",
  complete: "That is the setup behind us. From here I tell you what matters as it changes.",
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

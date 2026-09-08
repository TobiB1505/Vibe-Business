import type { CreditUnits } from "@/modules/credits/units";
import type { DeepScanViewModel } from "./view";

/**
 * Deep Scan, condensed to what My Product has room to say about it.
 *
 * ## Why this exists at all
 *
 * Deep Scan was reachable from exactly one place: a link inside the "Your
 * signed-in product" source row, worded `Deep Scan` and sized like every other
 * remedy link on the page. A founder reading My Product could not tell that
 * the most expensive and most revealing source Vibe has was sitting behind it,
 * and — once a scan had run — could not tell that it had found anything.
 *
 * So the source row keeps doing its job (four sources, one honest state each)
 * and this says the other half out loud: what the signed-in read is for, what
 * the last one saw, and where to go next.
 *
 * ## Why it derives from the panel's own view model
 *
 * Entitlement, cooldown, price and provider availability are already answered
 * once, by `buildDeepScanViewModel`. A second summary that re-read
 * `includedScanAvailable` and `additionalScanPrice` and reached its own verdict
 * would be a copy free to drift — and the first thing it would get wrong is
 * telling a founder a scan costs 25 Credits while their included one is still
 * unused. This narrows that model; it never re-decides it.
 *
 * ## The shape it enforces
 *
 * An `action` of `null` always comes with a `note`. A prominent card offering
 * neither a way forward nor a reason there is none is a dead end, and putting
 * it at the top of My Product would make it a loud one. A note may also
 * accompany an action — a Credit balance that is short does not remove the
 * way forward, it stands in front of it.
 */

export type DeepScanSpotlightState =
  /** A snapshot exists: the card leads with what was read. */
  | "read"
  /** A browser session is open, or an analysis is running. */
  | "in_progress"
  /** Nothing read yet, and a scan can be offered. */
  | "never_run"
  /** Nothing to sign in to, no provider, or nothing purchasable. */
  | "unavailable";

/** One counted fact. Present only when it was genuinely measured. */
export type DeepScanSpotlightFact = { label: string; value: string };

export type DeepScanSpotlightAction = {
  label: string;
  /**
   * What the *next* scan costs, or null when it costs nothing to the founder.
   * `included` separates the two reasons a price is absent: covered by the
   * project's included scan, or simply not the thing this link does.
   */
  price: CreditUnits | null;
  included: boolean;
};

export type DeepScanSpotlight = {
  state: DeepScanSpotlightState;
  /** The sentence that leads. What Vibe knows, or does not know yet. */
  headline: string;
  /** Why that matters, in a founder's terms. Never internals. */
  detail: string;
  /** Counted facts about the last read. Empty until one exists. */
  facts: DeepScanSpotlightFact[];
  /**
   * When the last read finished, ISO, or null. Left unformatted: a timestamp
   * is rendered in the reader's own locale, and that is the component's job.
   */
  analyzedAt: string | null;
  /**
   * Surfaces Vibe recognised, by name. The names only — the evidence behind
   * each one lives on the Deep Scan panel, which has room to open it.
   */
  surfaces: string[];
  /** The doorway. Null only when there is genuinely nothing behind it. */
  action: DeepScanSpotlightAction | null;
  /**
   * What stands in the way. Never null alongside a null action; sometimes set
   * beside one, when the obstacle is surmountable from the Deep Scan page.
   */
  note: string | null;
};

/** "Vibe has never signed in to your product." — the constant half of the copy. */
const NEVER_RUN_DETAIL =
  "A Deep Scan opens a temporary browser, hands it to you to sign in, and reads what your product looks like from the inside. Nothing Vibe reads from the outside can see that.";

const IN_PROGRESS_DETAIL =
  "A temporary browser is open for this project. The Deep Scan page is where you finish signing in and watch it read.";

function pluralise(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/**
 * The headline for a finished scan.
 *
 * Pages first because it is the measured fact, and the surfaces are named
 * underneath rather than crammed in here — a headline listing five surface
 * names is a list, and a list is not a sentence.
 */
function readHeadline(pagesInspected: number, screens: number): string {
  if (screens === 0) return `Vibe read ${pluralise(pagesInspected, "page")} inside your product.`;
  return `Vibe read ${pluralise(pagesInspected, "page")} across ${pluralise(screens, "screen")} inside your product.`;
}

/**
 * The doorway, worded the way the panel words it.
 *
 * "Run free Deep Scan" rather than a price for the included scan: printing
 * `25 Credits` beside a control that will charge nothing is the one mistake
 * this whole derivation exists to make impossible.
 */
function actionFor(model: DeepScanViewModel): DeepScanSpotlightAction | null {
  switch (model.nextScan.kind) {
    case "included":
      return { label: "Run free Deep Scan", price: null, included: true };
    case "priced":
    case "insufficient_credits":
      return { label: "Run Deep Scan", price: model.nextScan.price, included: false };
    default:
      return null;
  }
}

/**
 * Why no scan is on offer, said plainly enough to sit at the top of a page.
 *
 * `blocked` is temporary and says so; `not_for_sale` and `unavailable` are
 * not the founder's doing, and the wording never implies they are.
 */
function noteFor(model: DeepScanViewModel): string | null {
  switch (model.nextScan.kind) {
    case "insufficient_credits":
      return "You don't have enough Credits for another Deep Scan yet.";
    case "not_for_sale":
      return "This project's included Deep Scan has been used, and no additional one is on sale right now.";
    case "blocked":
      return "Another Deep Scan can't start just yet. The Deep Scan page says when.";
    case "unavailable":
      return model.nextScan.reason === "production_url_missing"
        ? "Add your production website URL, and Vibe can sign in to it."
        : "Deep Scan isn't switched on here yet. That's a gap on Vibe's side — it says nothing about your product.";
    default:
      return null;
  }
}

export function buildDeepScanSpotlight(model: DeepScanViewModel | null): DeepScanSpotlight {
  /*
   * No model at all means the project has no repository, which is the one
   * blocker My Product already leads with. The card still appears — a source
   * that silently vanishes when it is unavailable is a source a founder never
   * learns exists.
   */
  if (!model) {
    return {
      state: "unavailable",
      headline: "Vibe hasn't seen your product signed in.",
      detail: NEVER_RUN_DETAIL,
      facts: [],
      analyzedAt: null,
      surfaces: [],
      action: null,
      note: "Deep Scan needs a connected repository and a production website first.",
    };
  }

  /*
   * `activeSession` is already only ever a *live* session — `getActiveSession`
   * filters on the live statuses and drops an expired row on read. So its
   * presence is the whole question, and re-checking the status here would be
   * a second, weaker copy of that rule.
   */
  if (model.activeSession !== null) {
    return {
      state: "in_progress",
      headline: "A Deep Scan is running.",
      detail: IN_PROGRESS_DETAIL,
      facts: [],
      analyzedAt: null,
      surfaces: [],
      action: { label: "Open Deep Scan", price: null, included: false },
      note: null,
    };
  }

  const result = model.lastResult;

  if (result) {
    /*
     * Counted, never zero-filled. "0 tables" is a finding about the product;
     * a fact Vibe did not measure is an absence, and the two must not read
     * the same (rule 44).
     */
    const facts: DeepScanSpotlightFact[] = [
      { label: "Pages read", value: String(result.pagesInspected) },
      { label: "Screens", value: String(result.screens.length) },
    ];
    if (result.shape.navigation.length > 0) {
      facts.push({ label: "Nav items", value: String(result.shape.navigation.length) });
    }

    return {
      state: "read",
      headline: readHeadline(result.pagesInspected, result.screens.length),
      detail:
        result.surfaces.length > 0
          ? "These are the parts of your product only a signed-in read can reach. Vibe's understanding below rests on them."
          : "Vibe read your signed-in pages but recognised none of the surfaces it looks for. The Deep Scan page says what it saw.",
      facts,
      analyzedAt: result.analyzedAt,
      surfaces: result.surfaces.map((surface) => surface.name),
      action: { label: "See what Vibe read", price: null, included: false },
      note: null,
    };
  }

  const action = actionFor(model);

  return {
    state: action ? "never_run" : "unavailable",
    headline: model.recommendationReason
      ? "Most of your product is behind your sign-in."
      : "Vibe has only seen your product signed out.",
    detail: model.recommendationReason
      ? `${model.recommendationReason} ${NEVER_RUN_DETAIL}`
      : NEVER_RUN_DETAIL,
    facts: [],
    analyzedAt: null,
    surfaces: [],
    action,
    note: noteFor(model),
  };
}

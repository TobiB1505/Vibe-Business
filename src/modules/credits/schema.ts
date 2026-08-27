import type { CreditUnits } from "./units";

/**
 * The billing domain model (BILLING CORE-1 §2, §9, §16, §17, §18).
 *
 * ## The four concepts this file exists to keep apart
 *
 * ```
 * Provider usage    physical units a provider billed us for      tokens, ms, bytes
 * Raw provider cost what Vibe pays the provider                  internal, nanodollars
 * Credit rating     what that usage rates to for a customer      policy, versioned
 * Posted charge     what was actually taken from a balance       immutable, ledgered
 * ```
 *
 * They are four different questions with four different authorities, and every
 * expensive billing mistake comes from collapsing two of them. A reservation is
 * not a charge. An estimate is not a reservation. A provider price change is
 * not a customer price change. And — the one this codebase already had strong
 * opinions about — an unknown cost is not a zero cost.
 */

/* ---------------------------------------------------------------------------
 * Ledger
 * ------------------------------------------------------------------------ */

/**
 * Kinds of **posted** balance change (§9).
 *
 * Every one of these moves the posted balance and is immutable once written.
 * Note what is absent: there is no `RESERVATION` kind, because a hold is not a
 * balance change — it is a claim against an unchanged balance, and modelling it
 * here would make available balance unreconstructable.
 */
export const CREDIT_LEDGER_KINDS = [
  /** Credits issued by Vibe — onboarding allowance, goodwill, plan allocation. */
  "grant",
  /** Credits bought with real money. Written by Billing Core 2, never by a client. */
  "purchase",
  /** Credits consumed by a settled operation. Always negative. */
  "charge",
  /** A compensating positive entry against an earlier charge (§30). */
  "refund",
  /** A deliberate manual correction, always carrying a stated reason (§31). */
  "adjustment",
  /**
   * Credits that lapsed unspent (BILLING CORE-2 §10, §59, §60). Always negative.
   *
   * Expiration is a posted event rather than a read-time filter or a deletion.
   * That keeps `posted_credits` — the figure Core-1's atomic reservation gate
   * is evaluated against — honest without changing that primitive at all, and
   * it keeps the grant that lapsed in history: "100 Welcome Credits, expired
   * Aug 30" stays answerable forever.
   */
  "expiry",
] as const;
export type CreditLedgerKind = (typeof CREDIT_LEDGER_KINDS)[number];

/** Kinds whose delta must be negative. Enforced in the database as well as here. */
export const DEBIT_KINDS: readonly CreditLedgerKind[] = ["charge", "expiry"] as const;

/** Kinds whose delta must be positive. `adjustment` is deliberately in neither. */
export const CREDIT_KINDS: readonly CreditLedgerKind[] = ["grant", "purchase", "refund"] as const;

/* ---------------------------------------------------------------------------
 * Reservations and quotes
 * ------------------------------------------------------------------------ */

/**
 * Reservation lifecycle (§11).
 *
 * `active` holds credits against the available balance without posting
 * anything. Exactly one terminal transition may follow, and each has a distinct
 * meaning a report has to be able to tell apart: `settled` means real work was
 * charged, `released` means it was given back deliberately, `expired` means
 * nobody ever came back for it.
 */
export const RESERVATION_STATUSES = ["active", "settled", "released", "expired"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const ACTIVE_RESERVATION_STATUS: ReservationStatus = "active";

/** Quote lifecycle (§14). A quote authorizes nothing on its own. */
export const QUOTE_STATUSES = ["open", "accepted", "expired", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/* ---------------------------------------------------------------------------
 * Billable usage
 * ------------------------------------------------------------------------ */

/**
 * Where a normalized usage row came from (§16).
 *
 * Billing never becomes the source of truth for provider usage. Each of these
 * names an existing canonical table that keeps its own authority; a billing
 * usage row is a *projection* carrying a reference back, never a copy of it.
 */
export const USAGE_SOURCE_KINDS = [
  "ai_usage_event",
  "deep_scan_provider_usage",
  "sandbox_usage_event",
  "review_browser_usage",
] as const;
export type UsageSourceKind = (typeof USAGE_SOURCE_KINDS)[number];

/**
 * Measurable provider units (§17).
 *
 * Every entry here is something Vibe **actually observes today**.
 *
 * Cache read and cache write are here, and the distinction between them and
 * `anthropic_thinking_tokens` is the one thing to understand about this list.
 * Thinking is *informational*: Anthropic already counts it inside the output
 * tokens it bills, so it is in `NON_CHARGEABLE_SKUS` and rating skips it.
 * Cache is the opposite — a response counts cache reads and cache writes
 * separately from the uncached input charged at the base rate, and bills them
 * at 0.1× and 1.25× input. They are separately-billed units, so they stay
 * rateable.
 *
 * That has a consequence worth stating plainly, because it is the point of
 * metering them at all. `CREDIT_RATE_CARDS` is empty, so nothing changes today.
 * The first card that lists neither SKU will make `rateUsage` return
 * `sku_not_priced` rather than charge zero for the 55–70% of agent provider
 * cost `ECONOMY_MODEL.md` measured in cache. Refusing to rate is the intended
 * behaviour; billing nothing was the defect.
 *
 * The *cost* axis is unaffected and unchanged: `costForAiRow` prices cache into
 * one figure for the whole call, and that figure rides on the input row alone.
 */
export const USAGE_SKUS = [
  "anthropic_input_tokens",
  "anthropic_output_tokens",
  /** Reported for transparency. Already inside `anthropic_output_tokens`. */
  "anthropic_thinking_tokens",
  /** Cached input read back, billed at 0.1× input and counted separately from it. */
  "anthropic_cache_read_tokens",
  /** Input written to the cache, billed at 1.25× input and counted separately from it. */
  "anthropic_cache_write_tokens",
  /** Remote browser wall-clock, Deep Scan and visual review alike. */
  "browser_duration_ms",
  /** Vercel sandbox wall-clock. */
  "sandbox_duration_ms",
  /** Vercel sandbox billed CPU. */
  "sandbox_active_cpu_ms",
  "sandbox_ingress_bytes",
  "sandbox_egress_bytes",
] as const;
export type UsageSku = (typeof USAGE_SKUS)[number];

/** The physical unit a SKU is counted in. Kept explicit so rating never guesses. */
export const SKU_UNITS: Record<UsageSku, "tokens" | "milliseconds" | "bytes"> = {
  anthropic_input_tokens: "tokens",
  anthropic_output_tokens: "tokens",
  anthropic_thinking_tokens: "tokens",
  anthropic_cache_read_tokens: "tokens",
  anthropic_cache_write_tokens: "tokens",
  browser_duration_ms: "milliseconds",
  sandbox_duration_ms: "milliseconds",
  sandbox_active_cpu_ms: "milliseconds",
  sandbox_ingress_bytes: "bytes",
  sandbox_egress_bytes: "bytes",
};

/**
 * SKUs that are informational only and must never be priced (§17).
 *
 * Thinking tokens are the case: Anthropic already includes them in the output
 * count, so rating them again would double-charge reasoning. They are recorded
 * because they are real and billed — just not *separately* billed.
 */
export const NON_CHARGEABLE_SKUS: readonly UsageSku[] = ["anthropic_thinking_tokens"] as const;

/* ---------------------------------------------------------------------------
 * Cost and rating status — the "unknown is not zero" rule
 * ------------------------------------------------------------------------ */

/**
 * Whether Vibe knows what a usage row cost **it** (§18).
 *
 * This is the single most important enum in the module. Three of Vibe's four
 * provider ledgers store `provider_cost_usd` as null on purpose — Browserbase
 * and Vercel do not return an attributable price, and the existing code refuses
 * to derive one from a public rate card because "a figure derived from public
 * rate cards would be an estimate wearing an accounting figure's clothes".
 *
 * `cost_unknown` carries that forward. It must never be summed as zero, and a
 * report that adds known and unknown costs into one total is lying.
 */
export const COST_STATUSES = [
  /** A real price, computed by the authoritative pricing module. */
  "costed",
  /** The provider does not report a price and Vibe refuses to invent one. */
  "cost_unknown",
  /** Priced in principle, but no price is configured for this model/date. */
  "rate_unavailable",
  /** Positively known to cost nothing. Never a default. */
  "not_billable",
] as const;
export type CostStatus = (typeof COST_STATUSES)[number];

/**
 * Whether usage has been converted into customer Credits (§6, §21).
 *
 * `rate_card_not_configured` is the honest steady state of Billing Core 1:
 * Vibe has no approved production Credit rate, so usage is measured and costed
 * but not rated. That is a *better* answer than a number, and it is why this is
 * an explicit status rather than a null Credit amount that a caller might
 * coalesce to zero.
 */
export const RATING_STATUSES = [
  "rated",
  /** No production Credit rate card exists yet. The Core 1 default. */
  "rate_card_not_configured",
  /** A rate card exists but prices no line for this SKU. */
  "sku_not_priced",
  /** Cost/usage could not be established, so rating was not attempted. */
  "not_rateable",
] as const;
export type RatingStatus = (typeof RATING_STATUSES)[number];

/* ---------------------------------------------------------------------------
 * Shapes
 * ------------------------------------------------------------------------ */

/**
 * One normalized, provider-neutral unit of billable consumption (§16).
 *
 * Deliberately absent: prompt text, model responses, reasoning, source code,
 * screenshots, credentials. Billing stores an amount, a reference and an
 * identity — never the content that produced them (§44).
 */
export type BillableUsage = {
  sourceKind: UsageSourceKind;
  /** Primary key of the row in the canonical provider ledger. */
  sourceId: string;
  /** The durable operation this belongs to, when it can be resolved (§25). */
  operationRunId: string | null;
  projectId: string;
  /** The economic owner, derived from ownership — never supplied by a caller (§56). */
  userId: string;
  provider: string;
  sku: UsageSku;
  /** Whole units of {@link SKU_UNITS}. Never fractional, never negative. */
  quantity: number;
  occurredAt: string;
  /** Exact integer nanodollars, matching `ai/pricing.ts`. Null unless `costed`. */
  rawCostNanoUsd: number | null;
  costStatus: CostStatus;
  /** The provider pricing version that produced `rawCostNanoUsd`, when costed. */
  providerPricingVersion: string | null;
};

/** A rating decision. Retains every identity needed to explain it later (§23). */
export type UsageRating = {
  status: RatingStatus;
  /** Null unless `status === "rated"`. Never coalesce this to zero. */
  credits: CreditUnits | null;
  /** The Credit policy version that produced it — pinned onto the charge (§22). */
  rateCardVersion: string | null;
};

/**
 * Balance (§10).
 *
 * `available` is the only figure an operation may spend against, and it is
 * derived rather than stored so it cannot drift from the two figures that
 * define it.
 */
export type CreditBalance = {
  /** Sum of every immutable ledger delta. */
  posted: CreditUnits;
  /** Sum of currently active reservations. */
  reserved: CreditUnits;
  /** `posted - reserved`. */
  available: CreditUnits;
};

/** Why a reservation was refused. Never a bare boolean — the caller must explain. */
export const RESERVATION_REFUSALS = [
  "insufficient_credits",
  "account_not_found",
  "account_suspended",
  "invalid_amount",
] as const;
export type ReservationRefusal = (typeof RESERVATION_REFUSALS)[number];

/** Why a settlement could not complete (§28). */
export const SETTLEMENT_REFUSALS = [
  /** Actual usage rated above the maximum the customer approved. */
  "additional_credits_required",
  "reservation_not_found",
  "reservation_not_active",
  "invalid_amount",
  /**
   * A charge exists and the hold it was taken against was given back (§I1).
   *
   * Not a retry, and not a refusal of anything the caller asked for — both
   * halves of the settlement already happened, and they disagree. The customer
   * was charged, and the capacity that charge was supposed to consume was
   * returned to them. Reporting this as a success would hide the one state
   * separating the money question from the cleanup question exists to reveal.
   */
  "charge_without_hold",
] as const;
export type SettlementRefusal = (typeof SETTLEMENT_REFUSALS)[number];

/**
 * Business Context — **retired as a model in CORE-2 §4.**
 *
 * ## What happened to it
 *
 * Sprint 4 introduced this as the answer to "who is this product for, and what
 * is the founder trying to do?", because nothing else could answer it. CORE-1
 * built the Product Profile, which answers the product half from evidence
 * before anyone is asked anything, and CORE-2 removed the duplication:
 *
 *     productSummary    →  Product Profile correction `shortDescription`
 *     targetCustomer    →  Product Profile correction `primaryAudience`
 *     stage             →  Founder Intent
 *     monetizationModel →  Founder Intent
 *     primaryGoal       →  Founder Intent
 *
 * The table is dropped, the store is deleted, the form is gone, and no code
 * path can write one. See `founder-intent.ts` for what survived and why, and
 * the migration `20260816020000_founder_intent_and_audit_traceability.sql` for
 * how existing rows were carried across.
 *
 * ## Why this file still exists
 *
 * Evidence packs `business-evidence.v1` and `.v2` are the contracts that
 * previously stored audits were produced under. Their builders still describe
 * what those packs contained, and describing it requires this shape. Rewriting
 * them would silently change what an old `evidencePackVersion` means, which is
 * the one thing versioned contracts exist to prevent.
 *
 * So this is a **frozen record of a shape that no longer has a home**: a type
 * and nothing else. The parser and the content hash are deleted rather than
 * kept, because those were the write path, and a write path is exactly what
 * CORE-2 §4 requires not to survive.
 *
 * Do not build anything new on this type.
 */

export type ProjectStage = "prototype" | "launched_no_users" | "active_users" | "paid_customers";

export type MonetizationModel =
  | "none"
  | "planned"
  | "free"
  | "subscription"
  | "one_time"
  | "usage_based"
  | "marketplace"
  | "other";

export type PrimaryGoal =
  | "launch"
  | "get_first_users"
  | "monetize"
  | "improve_conversion"
  | "improve_retention"
  | "grow_revenue";

export type BusinessContext = {
  productSummary: string;
  targetCustomer: string | null;
  stage: ProjectStage | null;
  monetizationModel: MonetizationModel | null;
  primaryGoal: PrimaryGoal | null;
};

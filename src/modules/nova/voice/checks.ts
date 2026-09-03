import { findCausalClaims } from "@/modules/business-measurement/causality";
import {
  MAX_NOVA_MESSAGE_CHARS,
  MAX_NOVA_MESSAGE_PARAGRAPHS,
  MIN_NOVA_MESSAGE_CHARS,
} from "./payload";

/**
 * What Vibe refuses to show a founder, whatever the model wrote.
 *
 * ## Why a validator exists at all, given the eval
 *
 * Because fifty cases cannot prove a rate. Zero failures across fifty cases
 * puts the 95% upper bound on the failure rate at roughly six percent — which
 * is a fine result for a *quality* metric and no result at all for a safety
 * one. The eval says the prompt is good enough to ship; this file is what
 * makes the guarantee, on every message, forever. Deleting it because the eval
 * passed would be reading the eval backwards.
 *
 * ## What it can and cannot decide
 *
 * It decides the checkable things: fabricated numerals, claims this product is
 * never entitled to make, causal claims, Vibe's internal vocabulary, shape and
 * length. It cannot decide whether a message invented a *recommendation* — a
 * fluent, correctly-shaped sentence that quietly adds a priority the payload
 * never named looks exactly like a good one to a regular expression. That case
 * is why the eval has a judge, and why the judge is the expensive model.
 *
 * ## Precision over recall, deliberately
 *
 * Every rule here is one a correct message cannot trip. A validator that
 * refuses good output teaches the surrounding code to bypass it, and the
 * fallback is only ever a template — so a false rejection costs a nicer
 * sentence, while a false acceptance costs a false statement to a founder.
 * The soft signals that would be useful but cannot be made precise are
 * reported as warnings and score nothing.
 */

export const NOVA_CHECK_FAILURES = [
  /** Blank, or too short to be a message. */
  "empty_message",
  "too_long",
  "too_many_paragraphs",
  /** Lists, headings, code fences — the feed renders prose. */
  "markdown_structure",
  /** A numeral the payload did not authorize. */
  "unallowed_number",
  /** A claim this product is never in a position to make. */
  "banned_claim",
  /** "caused", "led to", "thanks to" — reuses the measurement detector. */
  "causal_claim",
  /** Vibe's own module vocabulary reached the founder. */
  "module_name",
  /** A case-specific string that would be false in this exact state. */
  "forbidden_content",
] as const;

export type NovaCheckFailureCode = (typeof NOVA_CHECK_FAILURES)[number];

export const NOVA_CHECK_WARNINGS = [
  /**
   * A spelled-out quantity ("two areas", "three files").
   *
   * A warning rather than a failure because it is the one rule that cannot be
   * made precise: "one thing" and "a couple of places" are ordinary English,
   * and the payload has no numeral to check them against. Recorded so the eval
   * can show how often it happens before anyone decides whether it matters.
   */
  "spelled_quantity",
] as const;

export type NovaCheckWarningCode = (typeof NOVA_CHECK_WARNINGS)[number];

export type NovaCheckFinding<Code> = { code: Code; detail: string };

export type NovaCheckResult = {
  ok: boolean;
  failures: NovaCheckFinding<NovaCheckFailureCode>[];
  warnings: NovaCheckFinding<NovaCheckWarningCode>[];
};

/**
 * Claims that are false in this product **regardless of state**.
 *
 * The distinction that makes this list safe to apply unconditionally: none of
 * these is ever true of anything Vibe does. Vibe moves a default branch and
 * reads it back; it calls no deployment provider and observes no release, so
 * "deployed", "live" and "shipped" are not states it can report ([rule 74]).
 * "Safe", "guaranteed" and "bug-free" are not conclusions a passing validation
 * supports ([rule 66]).
 *
 * Claims that are false only *sometimes* — "the checks passed" while validation
 * is still running — are not here. They belong to the case, and arrive through
 * `forbiddenSubstrings`, because the same sentence is perfectly honest one
 * state later.
 */
export const ALWAYS_BANNED_CLAIMS = [
  "deployed",
  "is live",
  "now live",
  "went live",
  "goes live",
  "shipped",
  "released",
  "in production",
  "production ready",
  "production-ready",
  "is safe",
  "safe to",
  "perfectly safe",
  "guaranteed",
  "guarantees that",
  "bug-free",
  "bug free",
  "error-free",
  "error free",
  "nothing can go wrong",
  "works perfectly",
  "everything works",
  "fully tested",
  "proven correct",
  "verified correct",
] as const;

/**
 * Vibe's own words for its machinery.
 *
 * The same prohibition `command-center-ui.test.ts` enforces over the hand-
 * written screens, applied to generated prose. Product vocabulary a founder is
 * meant to learn — "Move", "Action Plan", "Deep Scan", "Agent" — is
 * deliberately absent: those are the names the product teaches, not the names
 * it hides.
 */
export const BANNED_MODULE_NAMES = [
  "repository intelligence",
  "live product intelligence",
  "live product check",
  "product profile",
  "execution spec",
  "operation run",
  "opportunity set",
  "input hash",
  "snapshot",
  "resolver",
  "workflow",
  "evidence pack",
] as const;

/** Nouns that turn a spelled-out numeral into a quantity claim. */
const COUNTABLE_NOUNS = [
  "files",
  "changes",
  "credits",
  "checks",
  "areas",
  "moves",
  "steps",
  "issues",
  "problems",
  "points",
  "lenses",
  "opportunities",
  "things",
];

const SPELLED_NUMBERS = [
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/**
 * Words that turn a claim into its denial.
 *
 * The same problem `causality.ts` solved and for the same reason: Nova must be
 * able to write *"this does not mean the change is live"*, and a bare substring
 * match would refuse the very sentence that keeps the product honest.
 */
const NEGATIONS = [
  "not ",
  "never",
  "no ",
  "cannot",
  "can not",
  "isn't",
  "is not",
  "does not",
  "doesn't",
  "won't",
  "will not",
  "without",
  "nothing is",
];

/** How far back a negation may sit and still govern the phrase. */
const NEGATION_WINDOW = 60;

function findUnnegated(normalized: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(phrase, from);
      if (at === -1) return false;

      const preceding = normalized.slice(Math.max(0, at - NEGATION_WINDOW), at);
      if (!NEGATIONS.some((negation) => preceding.includes(negation))) return true;

      from = at + phrase.length;
    }
  });
}

/** Every maximal run of digits, with separators inside a figure preserved. */
export function numeralsIn(message: string): string[] {
  return message.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

function paragraphsOf(message: string): string[] {
  return message
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export type NovaCheckInput = {
  message: string;
  /** Every numeral the payload authorized. */
  allowedNumericFacts: readonly string[];
  /**
   * Strings that would be false in this exact state.
   *
   * Case-insensitive. This is where "passed" goes while validation is still
   * running, and where an injected instruction's payload goes so that a message
   * repeating it fails rather than merely looking odd.
   */
  forbiddenSubstrings?: readonly string[];
};

export function checkNovaMessage(input: NovaCheckInput): NovaCheckResult {
  const failures: NovaCheckFinding<NovaCheckFailureCode>[] = [];
  const warnings: NovaCheckFinding<NovaCheckWarningCode>[] = [];

  const message = input.message ?? "";
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");

  if (trimmed.length < MIN_NOVA_MESSAGE_CHARS) {
    failures.push({
      code: "empty_message",
      detail: `${trimmed.length} characters, minimum ${MIN_NOVA_MESSAGE_CHARS}`,
    });
    // Everything below reads the message as prose. There is none.
    return { ok: false, failures, warnings };
  }

  if (trimmed.length > MAX_NOVA_MESSAGE_CHARS) {
    failures.push({
      code: "too_long",
      detail: `${trimmed.length} characters, maximum ${MAX_NOVA_MESSAGE_CHARS}`,
    });
  }

  const paragraphs = paragraphsOf(trimmed);
  if (paragraphs.length > MAX_NOVA_MESSAGE_PARAGRAPHS) {
    failures.push({
      code: "too_many_paragraphs",
      detail: `${paragraphs.length} paragraphs, maximum ${MAX_NOVA_MESSAGE_PARAGRAPHS}`,
    });
  }

  if (/^\s*[-*+]\s/m.test(trimmed) || /^#{1,6}\s/m.test(trimmed) || trimmed.includes("```")) {
    failures.push({ code: "markdown_structure", detail: "list, heading or code fence" });
  }

  const allowed = new Set(input.allowedNumericFacts);
  for (const numeral of numeralsIn(trimmed)) {
    if (!allowed.has(numeral)) {
      failures.push({ code: "unallowed_number", detail: numeral });
    }
  }

  for (const claim of findUnnegated(normalized, ALWAYS_BANNED_CLAIMS)) {
    failures.push({ code: "banned_claim", detail: claim });
  }

  for (const claim of findCausalClaims(trimmed)) {
    failures.push({ code: "causal_claim", detail: claim });
  }

  for (const name of BANNED_MODULE_NAMES) {
    if (normalized.includes(name)) failures.push({ code: "module_name", detail: name });
  }

  for (const forbidden of input.forbiddenSubstrings ?? []) {
    if (normalized.includes(forbidden.toLowerCase().replace(/\s+/g, " "))) {
      failures.push({ code: "forbidden_content", detail: forbidden });
    }
  }

  for (const numberWord of SPELLED_NUMBERS) {
    const pattern = new RegExp(`\\b${numberWord}\\b[^.!?]{0,24}?\\b(${COUNTABLE_NOUNS.join("|")})\\b`);
    const hit = pattern.exec(normalized);
    if (hit) warnings.push({ code: "spelled_quantity", detail: hit[0] });
  }

  return { ok: failures.length === 0, failures, warnings };
}

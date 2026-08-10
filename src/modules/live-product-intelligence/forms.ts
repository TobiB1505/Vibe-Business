import type { ParsedForm } from "./html";
import type { Confidence, FormKind, FormSignal } from "./schema";

/**
 * Structural form classification (Sprint 3 §18).
 *
 * Only shape is read: how many fields, of which *types*, and what the
 * submit button is labelled. Field names, placeholder text, default
 * values and anything a user might have typed are never read and never
 * persisted — a login form is recognised by having a password input, not
 * by inspecting what is in it.
 *
 * Forms are never submitted. This module classifies markup that was
 * already fetched; it has no ability to send anything anywhere.
 */

const SIGNUP_HINT = /\b(?:sign ?up|register|create account|get started|registrieren|konto erstellen)\b/i;
const LOGIN_HINT = /\b(?:log ?in|sign ?in|anmelden|einloggen)\b/i;
const NEWSLETTER_HINT = /\b(?:subscribe|newsletter|join the list|stay updated|abonnieren)\b/i;
const CONTACT_HINT = /\b(?:contact|message|send|enquiry|inquiry|kontakt|nachricht|senden)\b/i;
const SEARCH_HINT = /\b(?:search|suche|suchen)\b/i;

/** Field types that never carry user-entered content and so should not count as "fields". */
const NON_INPUT_TYPES = new Set(["submit", "button", "image", "reset"]);

function meaningfulFieldTypes(form: ParsedForm): string[] {
  return form.fieldTypes.filter((type) => !NON_INPUT_TYPES.has(type));
}

export function classifyForm(form: ParsedForm): { kind: FormKind; confidence: Confidence } {
  const fields = meaningfulFieldTypes(form);
  const hint = `${form.submitLabel ?? ""} ${form.actionPath ?? ""}`;

  if (form.hasPassword) {
    // Two password fields are a password + confirmation — a registration
    // form nearly every time.
    if (form.passwordCount >= 2) return { kind: "signup_like", confidence: "high" };
    if (SIGNUP_HINT.test(hint)) return { kind: "signup_like", confidence: "high" };
    if (LOGIN_HINT.test(hint)) return { kind: "login_like", confidence: "high" };
    // A single password field with no other clue is far more often a
    // login than a registration.
    return { kind: "login_like", confidence: "medium" };
  }

  if (form.hasTextarea && (form.hasEmailField || fields.length >= 2)) {
    return { kind: "contact_like", confidence: CONTACT_HINT.test(hint) ? "high" : "medium" };
  }

  if (form.hasEmailField && fields.length <= 2) {
    if (NEWSLETTER_HINT.test(hint)) return { kind: "newsletter_like", confidence: "high" };
    if (CONTACT_HINT.test(hint)) return { kind: "contact_like", confidence: "medium" };
    // A lone email field is the classic newsletter capture.
    return { kind: "newsletter_like", confidence: "low" };
  }

  if (fields.includes("search") || SEARCH_HINT.test(hint)) {
    return { kind: "search_like", confidence: "medium" };
  }

  if (SIGNUP_HINT.test(hint)) return { kind: "signup_like", confidence: "low" };
  if (CONTACT_HINT.test(hint) && fields.length >= 2) {
    return { kind: "contact_like", confidence: "low" };
  }

  return { kind: "unknown", confidence: "low" };
}

export function toFormSignal(form: ParsedForm, path: string): FormSignal {
  const { kind, confidence } = classifyForm(form);
  const fields = meaningfulFieldTypes(form);

  return {
    kind,
    confidence,
    // Deduped types only. No names, no values (Sprint 3 §18).
    fieldTypes: [...new Set(fields)].slice(0, 12),
    fieldCount: fields.length,
    path,
  };
}

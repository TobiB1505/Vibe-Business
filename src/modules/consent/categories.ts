/**
 * What Vibe actually stores in a browser, and who it tells (UI-23).
 *
 * ## Why this file exists before any banner does
 *
 * A consent banner is a promise, and a promise about categories nobody
 * inventoried is a lie with a checkbox on it. Every category below names the
 * specific thing it gates, and every one of those things is switched off in
 * code by the same record — there is no category here that toggles nothing,
 * and nothing loads that is not listed here.
 *
 * The inventory, measured rather than assumed:
 *
 * | What | Category | Where |
 * |---|---|---|
 * | `sb-*-auth-token` | necessary | `src/lib/supabase/` — the session |
 * | `vibe-consent` | necessary | this module — the record of the choice itself |
 * | `vibe-last-project` | preferences | `src/modules/projects/last-visited.ts` |
 * | Vercel Web Analytics | analytics | `src/app/layout.tsx` |
 * | Vercel Speed Insights | analytics | `src/app/layout.tsx` |
 * | Meta Pixel (`_fbp`) | marketing | `src/components/analytics/meta-pixel.tsx` |
 *
 * ## What was wrong before it
 *
 * All three third-party tags loaded on first paint, with no consent asked. The
 * Meta Pixel is an advertising tag: it sets `_fbp` and reports every public
 * page view to Meta. Under TTDSG §25 and the GDPR that needs **prior** opt-in
 * in Germany, where this product is operated from — and `/privacy` already
 * listed "consent for advertising cookies where the law requires asking first,
 * and a way to decline" as something still missing. It was right.
 *
 * ## Why `necessary` has no switch
 *
 * Because a switch that cannot be turned off is a lie about who is deciding.
 * The session cookie is what "signed in" means, and the consent cookie is the
 * record of this choice — refusing either does not give a person more privacy,
 * it gives them a product that cannot remember they said no.
 */

/** The categories, in the order they are shown. `necessary` is always first. */
export const CONSENT_CATEGORIES = ["necessary", "preferences", "analytics", "marketing"] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/** The categories a person actually decides. `necessary` is not one of them. */
export const OPTIONAL_CATEGORIES = ["preferences", "analytics", "marketing"] as const satisfies
  readonly ConsentCategory[];

export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

export type CategoryDescription = {
  /** What a reader sees. */
  title: string;
  /** One sentence about what it is for — never "to improve your experience". */
  summary: string;
  /** The specific things it switches, named. */
  gates: string[];
  /** Whether it can be refused. */
  optional: boolean;
};

/**
 * Each category, described by what it does rather than by what it is called.
 *
 * "Analytics cookies help us improve our website" is the sentence every banner
 * writes and nobody believes. These say which company receives what.
 */
export const CATEGORY_DESCRIPTIONS: Record<ConsentCategory, CategoryDescription> = {
  necessary: {
    title: "Necessary",
    summary: "What signing in and staying signed in requires. These cannot be switched off.",
    gates: [
      "Your sign-in session, so you are not signed out on every page",
      "This choice itself, so you are not asked again on every visit",
    ],
    optional: false,
  },
  preferences: {
    title: "Preferences",
    summary: "Small conveniences Vibe remembers between visits. Nothing leaves Vibe.",
    gates: ["Which product you last opened, so /app goes there instead of asking"],
    optional: true,
  },
  analytics: {
    title: "Analytics",
    summary:
      "How many people reach a page and how quickly it loads. Vercel receives this; Vibe sees totals, not people.",
    gates: ["Vercel Web Analytics — page views", "Vercel Speed Insights — loading speed"],
    optional: true,
  },
  marketing: {
    title: "Marketing",
    summary:
      "Which advert brought somebody to Vibe. Meta receives the address of each public page you open.",
    gates: [
      "Meta Pixel — public pages only, never inside your workspace",
      "Off entirely outside production, whatever this says",
    ],
    optional: true,
  },
};

/** What each optional category is set to. `necessary` is not represented: it is not a choice. */
export type ConsentChoices = Record<OptionalCategory, boolean>;

/** Nothing optional, which is what an unanswered banner means until it is answered. */
export const REJECT_ALL: ConsentChoices = {
  preferences: false,
  analytics: false,
  marketing: false,
};

export const ACCEPT_ALL: ConsentChoices = {
  preferences: true,
  analytics: true,
  marketing: true,
};

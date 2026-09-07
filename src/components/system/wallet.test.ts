import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One wallet, and the traps it is built around.
 *
 * ## What this exists to catch
 *
 * Not a broken render. The defects here were: two rails drawing one object two
 * different ways, a tint that could never appear, and a caller formatting a
 * number the component is supposed to own.
 */

const WALLET = readFileSync("src/components/system/wallet.tsx", "utf8");
const AMOUNT = readFileSync("src/components/ui/credit-amount.tsx", "utf8");

/**
 * Code only.
 *
 * Every comment goes, block and JSX alike: the docblocks here explain the
 * traps by name — `IconButton`, `tailwind-merge`, "top up" — and a test that
 * counted prose would pass on an explanation and fail on an edit to one.
 */
function code(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

describe("the balance is one object", () => {
  it("is worn by both rails, because they are the same shape", () => {
    // The account rail drew a bare number and the word Credits; the project
    // rail drew a bordered chip. Same object, same place in the column, two
    // designs — which is how a product acquires a second design by accident.
    for (const rail of ["account-shell", "project-shell"]) {
      const layout = readFileSync(`src/components/layout/${rail}.tsx`, "utf8");
      const wearer =
        /\bWallet\b/.test(layout) ||
        // The project rail takes its footer from the route, so the wearer is
        // the layout that composes it rather than the shell itself.
        /\bWallet\b/.test(readFileSync("src/app/app/projects/[projectId]/layout.tsx", "utf8"));
      expect(wearer, `${rail} does not reach Wallet`).toBe(true);
    }
  });

  it("leaves no second balance drawn by hand", () => {
    // A number beside the literal word Credits, outside the two components
    // that own that pairing.
    const owners = [
      "src/components/system/wallet.tsx",
      "src/components/ui/credit-amount.tsx",
      "src/components/ui/credit-price.tsx",
    ];
    const offenders: string[] = [];
    for (const path of sourceFiles("src")) {
      if (owners.includes(path) || path.startsWith("src/app/e2e/design-studies/")) continue;
      // Billing is the ledger and states amounts in its own tables; the rails
      // are what this rule is about.
      if (!path.startsWith("src/components/layout/")) continue;
      const text = readFileSync(path, "utf8");
      for (const [line] of text.matchAll(/[^\n]*tabular-nums[^\n]*/g)) {
        if (/Credits/.test(line)) offenders.push(`${path}: ${line.trim().slice(0, 80)}`);
      }
    }
    expect(offenders, "A balance in a rail is `Wallet`.").toEqual([]);
  });

  it("takes units, never a formatted string", () => {
    // `CreditAmount` owns both the formatting and the coin's optical centring
    // against the digits. A caller that formats will eventually format
    // differently, and the coin will be a pixel low in exactly that place.
    expect(code(WALLET)).toContain("credits: CreditUnits | null");
    expect(code(WALLET)).not.toContain("display");
  });
});

describe("the tint can actually appear", () => {
  /**
   * `cn` is a filtered join, not `tailwind-merge`.
   *
   * A caller appending `text-amber` lands it beside `CreditAmount`'s own
   * colour in one class list and stylesheet order decides — which is how the
   * surface tones were written, generated, shipped and never seen. So the tone
   * is a prop the component resolves before the join.
   */
  it("resolves the low tone inside CreditAmount rather than at the call site", () => {
    expect(code(AMOUNT)).toContain("TONE_CLASSES[tone]");
    // The base list may not also carry a colour, or the prop is decoration.
    const base = AMOUNT.slice(AMOUNT.indexOf("inline-flex items-center gap-2"));
    expect(base.slice(0, base.indexOf('"'))).not.toContain("text-fg");
  });

  it("asks for the tone by name, not by class", () => {
    expect(code(WALLET)).toContain('tone={low ? "low" : "default"}');
  });
});

describe("adding Credits", () => {
  it("has exactly one destination, named once", () => {
    // A prop with one default rather than a literal at each call site: the
    // dedicated top-up screen is still to come, and re-pointing it must be one
    // edit rather than a search.
    expect(WALLET).toContain('export const TOP_UP_HREF = "/app/settings/billing#credit-packs"');
    expect(code(WALLET).match(/\/app\/settings\/billing/g) ?? []).toHaveLength(1);
  });

  it("is a link, because it navigates", () => {
    // A `<button>` that navigates is announced wrong and cannot be opened in a
    // new tab. `IconButton` is a button, so it is deliberately not used here.
    expect(code(WALLET)).toContain('aria-label="Top up Credits"');
    expect(code(WALLET)).not.toContain("IconButton");
  });

  it("says nothing about buying in the reading itself", () => {
    // The number stays a number. The action is a mark with no words, and the
    // block carries no banner, sentence or "upgrade".
    for (const word of ["Top up<", "Buy", "Upgrade", "Add Credits<"]) {
      expect(code(WALLET), `the wallet renders the word ${word}`).not.toContain(word);
    }
  });
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The identity is a link to the page about it.
 *
 * ## What this exists to catch
 *
 * Not a broken render. The defect was a disclosure whose contents were the
 * navigation standing next to it: the account menu offered Profile, Account
 * settings and Billing, and all three are rows in the Settings rail. A founder
 * had to open it to find that out, and it cost two clicks to reach a page one
 * click away.
 *
 * The half that actually needs guarding is the fourth item. Sign out was the
 * only thing in that menu with no other home, and deleting a disclosure is
 * exactly how a capability leaves a product without anybody noticing.
 */

const CARD = readFileSync("src/components/layout/account-card.tsx", "utf8");
const GENERAL = readFileSync("src/app/app/(account)/settings/page.tsx", "utf8");

/** Comments name the menu while explaining that it is gone. */
function code(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

describe("the account card", () => {
  it("is one link to the profile, with nothing to open", () => {
    const card = code(CARD);
    expect(card).toContain('href="/app/settings/profile"');
    expect(card, "the disclosure is back").not.toContain("<details");
    expect(card).not.toContain("<summary");
    // And it offers no second destination, or it is a menu again.
    expect(card.match(/href=/g) ?? []).toHaveLength(1);
  });

  /**
   * It wears the wallet's shape, because the two are a pair.
   *
   * The foot of the rail holds two account-level controls below the divider
   * that ends the navigation: what you can spend, and who you are. Drawing one
   * as a pill and the other as nothing-until-hovered is two treatments for one
   * kind of thing — which is the argument that took it out of the navigation's
   * row treatment, where it had been on the reasoning that it *was* a row.
   *
   * The height is asserted because that is what makes them read as a pair
   * rather than as two round things of nearly the same size.
   */
  it("is the same pill as the wallet beside it", () => {
    const card = code(CARD);
    const wallet = code(readFileSync("src/components/system/wallet.tsx", "utf8"));

    /*
     * Both take the surface from `buttonClasses` since UI-29, rather than
     * writing it out. This used to pin four literal classes — `rounded-full`,
     * `border-line-2`, `bg-surface-2`, `h-10` — and it fired correctly the
     * moment the wallet moved onto the system, which is the third time these
     * two hand-written copies of one pill have had to be re-synchronised.
     * Asserting the source rather than the spelling is what ends that.
     */
    for (const [name, source] of [
      ["the identity", card],
      ["the wallet", wallet],
    ] as const) {
      expect(source, `${name} does not take the system surface`).toContain(
        'buttonClasses({ variant: "ghost" })',
      );
      expect(source, `${name} is not the wallet's height`).toContain("h-10");
      expect(source, `${name} is not round`).toContain("rounded-full");
    }
  });

  /**
   * The field is around the avatar and the name, not around the rail.
   *
   * Full width left half of the pill empty, which reads as a large surface
   * with a person in the corner rather than as a control wrapped around an
   * identity. `max-w-full` is what keeps a long name inside the rail, and the
   * truncation on the name is what makes that safe.
   */
  it("sizes the field to its content, and never past the rail", () => {
    const card = code(CARD);
    expect(card).toContain("w-fit max-w-full");
    expect(card).toContain("truncate");
    // A stretching child would defeat `w-fit` from the inside.
    expect(card).not.toContain("flex-1");
  });

  it("answers a finger, which never hovers", () => {
    /*
     * Touch gets rest and pressed and nothing in between, so a press has to be
     * a visible step past hover rather than the same fill.
     *
     * This used to pin `active:bg-surface-3`, written here by hand. Since
     * UI-29 the press comes from the ghost variant — a bigger step than the
     * one this file wrote (`surface-pressed` at 11% against `surface-3` at 4%)
     * — so what this asserts is that the card takes it from there. That the
     * variant actually has a press step is `button.test.ts`'s to hold, and it
     * does: *gives every variant a press a finger can feel*.
     */
    expect(code(CARD)).toContain('buttonClasses({ variant: "ghost" })');
  });

  it("shows the avatar and the name, and nothing else to decide about", () => {
    const card = code(CARD);
    expect(card).toContain("<Avatar");
    expect(card).toContain("identity.displayName");
    // The chevron said "this opens". Nothing opens.
    expect(card).not.toContain("ChevronDownIcon");
    /*
     * And no second line. It said "Founder" on a product rail and "GitHub
     * account" on the account one — a constant and a fact Settings → Profile
     * states properly — and it was the reason this control was two lines tall
     * beside a one-line balance.
     */
    expect(card, "the subtitle is back").not.toContain("subtitle");
    expect(card).not.toContain("fromGithub");
  });
});

describe("sign out survived the menu", () => {
  it("has a home on the account's own page", () => {
    expect(code(GENERAL)).toContain("action={signOut}");
    expect(code(GENERAL)).toContain("Sign out");
  });

  /**
   * The account rails are the only chrome on a signed-in screen. If the
   * control existed nowhere a founder could reach without knowing a URL, the
   * product would have no way out — and every test would still pass.
   */
  it("is reachable from a signed-in surface, not only from a shell that is gone", () => {
    const wearers = sourceFiles("src").filter((path) => {
      if (path.endsWith("actions.ts")) return false;
      return /action=\{signOut\}/.test(readFileSync(path, "utf8"));
    });
    expect(wearers.length, "nothing renders a sign-out control").toBeGreaterThan(0);
    expect(wearers).toContain("src/app/app/(account)/settings/page.tsx");
  });
});

import Link from "next/link";
import { PlusIcon } from "@/components/ui/icons.generated";
import { CreditAmount } from "@/components/ui/credit-amount";
import { cn } from "@/lib/utils/cn";
import type { CreditUnits } from "@/modules/credits/units";

/**
 * What the account can spend, and the one way to add to it.
 *
 * ## Why it exists at all
 *
 * Every priced control in this product states its price. None of them could
 * state what the founder had, because the balance was read on the account
 * surfaces and nowhere else — so "35 Credits" was a number to compare against
 * a figure two navigations away. A price without a balance is half a
 * disclosure (audit R22).
 *
 * ## One wallet, both rails
 *
 * The account rail and the project rail are the same shape — a vertical column
 * with the balance directly above the account menu — and until now they drew
 * the balance two different ways: a bordered chip in one, a bare number and
 * the word "Credits" in the other, with no coin in either. Two presentations
 * of one object is how a product acquires a second design by accident, so
 * there is one component and both rails wear it.
 *
 * ## Why it now offers to add Credits
 *
 * This reverses a position the component used to hold and stated plainly:
 * "it does not offer to sell anything, does not say top up". The argument was
 * that a balance is a fact and a shop is a different thing, and it is a good
 * argument for the *number* — which is why the number is still just a number,
 * coloured when it is worth noticing and never a banner.
 *
 * What it got wrong is where the top-up lives. A founder who reads a low
 * balance in the rail has exactly one next move, and making them find Billing,
 * scroll to the packs and start again is not restraint — it is the balance
 * refusing to answer the question it just raised. The `+` is one 28px control
 * with no words, at the edge of a block whose subject is still the number.
 *
 * `topUpHref` points at Billing's own top-up section today. It is a prop
 * rather than a constant so it can be re-pointed at the dedicated top-up
 * screen in one place when that screen exists.
 *
 * ## Loading is not zero
 *
 * `null` renders nothing at all. A balance that has not been read is not a
 * balance of nothing, and a block reading "0 Credits" while a query is in
 * flight would tell a founder they cannot afford something they can. The rail
 * is one row shorter for a moment instead.
 */

/** Below this, the balance says so. A UI threshold, never a policy one. */
const LOW_CREDITS = 50_000;

/** Where Billing puts the packs. Named once so both defaults agree. */
export const TOP_UP_HREF = "/app/settings/billing#credit-packs";

export function Wallet({
  credits,
  href,
  topUpHref = TOP_UP_HREF,
  className,
}: {
  /**
   * Units, null while unread or when the account has no credit record yet.
   *
   * Units rather than a formatted string: `CreditAmount` owns both the
   * formatting and the coin's optical centring against the digits, and a
   * caller that formats is a caller that will eventually format differently.
   */
  credits: CreditUnits | null;
  /** Where the balance itself goes — the ledger, not the shop. */
  href: string;
  /** Where the `+` goes. Defaults to Billing's top-up section. */
  topUpHref?: string;
  className?: string;
}) {
  if (credits === null) return null;

  const low = credits < LOW_CREDITS;

  return (
    /*
      One pill with two halves, not a panel with a label.
      A box with a `BALANCE` caption above the number made the rail's quietest
      fact look like a section. The balance is one reading and one action, so
      it is one control: fully round, bordered, and reacting as a whole on
      hover the way the buttons around it do.

      A `div` rather than a link, because a link inside a link is not something
      a browser or a screen reader can resolve. The container carries the
      shape; each half carries its own target and its own focus ring.
    */
    <div
      data-testid="wallet"
      data-low={low || undefined}
      className={cn(
        "border-line-2 bg-surface-2 group/wallet flex items-stretch rounded-full border",
        "transition-interactive hover:border-line-strong",
        className,
      )}
    >
      <Link
        href={href}
        data-testid="wallet-balance"
        className={cn(
          "flex min-w-0 flex-1 items-center rounded-l-full py-2 pr-3 pl-4",
          "transition-interactive hover:bg-surface-hover",
          "focus-visible:ring-mint focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <CreditAmount credits={credits} size="sm" tone={low ? "low" : "default"} />
      </Link>

      {/* A hairline, inset from both ends so the pill reads as one shape
          rather than as two chips pushed together. */}
      <span aria-hidden className="bg-line-2 my-2 w-px shrink-0" />

      <Link
        href={topUpHref}
        aria-label="Top up Credits"
        className={cn(
          "vibe-control text-fg-muted grid w-10 shrink-0 place-items-center rounded-r-full",
          /*
            Quiet at rest, mint on the way in: adding Credits is Vibe's own
            action rather than a neutral one — the colour every priced control
            in the product already uses to mean "this is the thing you do
            here". The container exists at rest because a bare mark is not a
            control on a phone; here the container is the pill's own end.
          */
          "transition-interactive hover:bg-mint-tint hover:text-mint active:bg-mint-tint",
          "focus-visible:ring-mint focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <PlusIcon size={15} />
      </Link>
    </div>
  );
}

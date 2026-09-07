import Link from "next/link";
import { PlusIcon } from "@/components/ui/icons.generated";
import { CreditAmount } from "@/components/ui/credit-amount";
import { MonoLabel } from "@/components/ui/typography";
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
export const TOP_UP_HREF = "/app/billing#credit-packs";

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
      A block rather than one link, because it holds two destinations and a
      link inside a link is not a thing a browser or a screen reader can
      resolve. The container carries the surface; each half carries its own
      target and its own focus ring.
    */
    <div
      data-testid="wallet"
      data-low={low || undefined}
      className={cn(
        "border-line-2 bg-surface-2 rounded-panel flex flex-col gap-1.5 border px-3 py-2.5",
        "transition-interactive hover:border-line-strong",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <MonoLabel className="text-fg-meta">Balance</MonoLabel>
        {/*
          A `Link` styled as a control rather than `IconButton`, which is a
          `<button>`: this navigates, and a button that navigates is announced
          wrong and cannot be opened in a new tab. The states are the same
          three IconButton draws, at the one size that fits a rail label row.
        */}
        <Link
          href={topUpHref}
          aria-label="Top up Credits"
          className={cn(
            "vibe-control rounded-inset text-fg-muted grid size-7 shrink-0 place-items-center",
            /*
              Quiet at rest, mint on the way in. The container exists at rest
              because a bare mark is not a control on a phone (see
              `IconButton`), and it answers in mint because adding Credits is
              Vibe's own action rather than a neutral one — the same colour
              every priced control in the product uses to mean "this is the
              thing you do here".
            */
            "bg-surface-3 hover:bg-mint-tint hover:text-mint active:bg-mint-tint",
            "transition-interactive focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none",
          )}
        >
          <PlusIcon size={14} />
        </Link>
      </div>

      <Link
        href={href}
        data-testid="wallet-balance"
        className={cn(
          "rounded-inset -mx-1 px-1 py-0.5",
          "transition-interactive focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none",
        )}
      >
        <CreditAmount credits={credits} size="lg" tone={low ? "low" : "default"} />
      </Link>
    </div>
  );
}

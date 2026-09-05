import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { CostBalance } from "./cost-disclosure";

/**
 * What the account can spend, wherever a founder is (audit R22).
 *
 * ## Why it lives in the project rail
 *
 * Every priced control in this product states its price. None of them could
 * state what the founder had, because the balance was read on the account
 * surfaces and nowhere else — so "35 Credits" was a number to compare against
 * a figure two navigations away. A price without a balance is half a
 * disclosure.
 *
 * ## Loading is not zero
 *
 * `null` renders nothing at all. A balance that has not been read is not a
 * balance of nothing, and a chip reading "0 Credits" while a query is in
 * flight would tell a founder they cannot afford something they can. The rail
 * is one row shorter for a moment instead.
 *
 * ## Low is a fact, not a sales prompt
 *
 * Below the threshold the chip changes colour and stays a link to Billing.
 * It does not offer to sell anything, does not say "top up", and does not
 * appear differently on a screen with a priced control on it — the same
 * number in the same place, coloured when it is worth noticing.
 */

/** Below this, the chip says so. A UI threshold, never a policy one. */
const LOW_CREDITS = 50_000;

export function WalletChip({
  balance,
  href,
  className,
}: {
  /** Null while unread, or when the account has no credit record yet. */
  balance: CostBalance | null;
  href: string;
  className?: string;
}) {
  if (balance === null) return null;

  const low = balance.availableCredits < LOW_CREDITS;

  return (
    <Link
      href={href}
      data-testid="wallet-chip"
      data-low={low || undefined}
      className={cn(
        "border-line-2 bg-surface-2 rounded-nav flex items-baseline justify-between gap-3 border px-3 py-2",
        "hover:border-line-strong transition-interactive focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none",
        className,
      )}
    >
      <span className="text-fg-meta text-meta tracking-[0.12em] uppercase">Credits</span>
      <span className={cn("text-ui tabular-nums", low ? "text-amber" : "text-fg-body")}>
        {balance.display}
      </span>
    </Link>
  );
}

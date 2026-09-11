"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { PaletteSwitch } from "@/components/layout/palette-switch";
import { Wallet } from "@/components/system/wallet";
import { Avatar } from "@/components/ui/avatar";
import { ChevronRightIcon } from "@/components/ui/icons.generated";
import { Sheet } from "@/components/ui/sheet";
import type { AccountIdentity } from "@/modules/auth/identity-view";
import type { CreditUnits } from "@/modules/credits/units";
import type { Palette } from "@/app/palette";

/**
 * The account level, on a phone (UI-35).
 *
 * ## Why it is not in the tab bar
 *
 * Because it is not a section. The bar below holds the places inside one
 * product; this holds the things that are true of the whole account — what you
 * can spend, who you are, and the settings that belong to neither. Stacked
 * into one strip, as the rail was, those two levels read as one list of seven
 * equal things, and the balance and the identity ended up *above* the product
 * because the rail's footer became the page's third paragraph.
 *
 * Two levels, two places: sections along the bottom where the thumb is,
 * account behind one control in the corner. That separation is the design,
 * and the corner is the right home for the half a founder touches rarely.
 *
 * ## Why the avatar and not a burger
 *
 * A burger says "the rest of the navigation is in here" and this is not the
 * navigation. An avatar says whose account this is, which is what is actually
 * behind it — and it is the control every other product has trained people to
 * look for in exactly this corner.
 *
 * ## Why `Sheet` rather than a popover
 *
 * `Sheet` is a native `<dialog>` opened with `showModal()`, so focus moves in
 * and is trapped, the page behind goes inert, and Escape closes — four things
 * a hand-written popover would have to reimplement. `side="bottom"` because a
 * panel anchored to a corner on a 390px screen is a full-screen takeover
 * pretending to be a menu.
 */
export function MobileAccount({
  credits,
  identity,
  palette,
}: {
  credits: CreditUnits | null;
  identity: AccountIdentity;
  /** The deployed palette, or null outside the environments that may switch. */
  palette: Palette | null;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        /*
          Named for what it opens, not for who it shows. The avatar's own label
          is suppressed below so the control announces one thing.
        */
        aria-label="Your account"
        data-testid="mobile-account-trigger"
        /*
          Sized and placed off `--topbar-h`, so it is centred in the bar rather
          than near it: a 56px-tall target at the bar's own height, well past
          the 44px minimum, and it cannot drift if the bar's height changes.
        */
        className="pointer-events-auto fixed top-[env(safe-area-inset-top)] right-1 z-40 grid h-[var(--topbar-h)] w-14 place-items-center lg:hidden"
      >
        <span
          aria-hidden
          className="border-line-2 bg-surface-2 grid size-9 place-items-center rounded-full border"
        >
          <Avatar src={identity.avatarUrl} initials={identity.initials} label="" size={28} />
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" labelledBy={titleId}>
        {/*
        The body is mounted only while the sheet is open, and that is a
        correctness rule rather than a performance one (UI-35).

        Everything in here — the wallet, the switcher, the identity — is
        already rendered by the rail for a wide screen. Mounting both means one
        document holding two of each, which the browser suite caught
        immediately: `getByTestId('wallet')` resolved to two elements, and
        "offers one way to add Credits" is a claim about the product, not about
        a selector. A closed sheet holds nothing, so there is one of each until
        a founder actually opens it — at which point the rail's copy is
        `display:none` beside it.
      */}
        {open && (
          <div className="flex flex-col gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {/*
            The identity is the sheet's own heading — it names the dialog and
            it is the row that goes to the page about it, which is one thing
            doing one job rather than a title above a duplicate of itself.
          */}
            <Link
              href="/app/settings/profile"
              onClick={() => setOpen(false)}
              className="border-line-2 bg-surface-3 rounded-card flex min-h-14 items-center gap-3 border px-3"
            >
              <span aria-hidden className="shrink-0">
                <Avatar
                  src={identity.avatarUrl}
                  initials={identity.initials}
                  label={identity.displayName}
                  size={36}
                />
              </span>
              <span className="flex min-w-0 flex-col">
                <span id={titleId} className="text-fg-body truncate text-body font-semibold">
                  {identity.displayName}
                </span>
                <span className="text-fg-muted text-caption">Profile and account</span>
              </span>
              <ChevronRightIcon size={18} className="text-fg-muted ml-auto shrink-0" />
            </Link>

            {/*
            The same wallet the rail draws, not a phone-shaped copy of it. What
            a balance means and what it links to is one decision, and this is
            the third surface that would otherwise hold its own version of it.
          */}
            <Wallet credits={credits} href="/app/settings/billing" />

            <Link
              href="/app/settings"
              onClick={() => setOpen(false)}
              className="text-fg-secondary rounded-nav flex min-h-12 items-center px-3 text-body"
            >
              Account settings
              <ChevronRightIcon size={18} className="text-fg-muted ml-auto shrink-0" />
            </Link>

            {/*
            Outside production only, same as the rail's. It has to be reachable
            from every screen — including every phone screen — because that is
            the whole point of it.
          */}
            {palette !== null && (
              <div className="border-line-1 border-t pt-3">
                <PaletteSwitch deployed={palette} />
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { AccountIdentity } from "@/modules/auth/identity-view";
import { PaletteSwitch } from "@/components/layout/palette-switch";
import { activePalette, paletteSwitchable } from "@/app/palette";

/**
 * Who is signed in, at the foot of the rail. One control, one destination.
 *
 * ## Why the menu is gone
 *
 * It held four things and three of them are rows in the Settings rail now —
 * Profile, Account settings, Billing. A disclosure whose contents are the
 * navigation standing next to it is a second copy of the navigation, and the
 * founder has to open it to find that out.
 *
 * What is left is the identity itself, and an identity card is a link to the
 * page about that identity. That is what a person expects from an avatar and a
 * name, and it costs one click instead of two.
 *
 * ## Where sign out went
 *
 * To Settings → General, which is the page about this account. It was the one
 * thing in the menu with no other home, so it got one rather than being
 * dropped with the disclosure that carried it.
 *
 * ## Why it is a pill, having been a row that appeared on hover
 *
 * It has been three shapes. A bordered card, which was the odd one out in a
 * rail of borderless rows. Then a row with no container until you hovered it,
 * on the argument that an avatar and a name are self-describing at rest and
 * the rest of the rail is exactly that shape.
 *
 * That argument was about the *navigation*, and this is not in it. The foot of
 * the rail holds two account-level controls — what you can spend, and who you
 * are — and they sit below the divider that ends the navigation. Read as a
 * pair rather than as a last row, the balance being a pill and the identity
 * being nothing until touched is two treatments for one kind of thing. So it
 * is a pill, the same pill, and the pair reads as the pair it is.
 *
 * It still hugs its content rather than the rail: a full-width field left half
 * of itself empty, which reads as a large surface that happens to have a
 * person in the corner.
 *
 * ## Why the palette switch stays here
 *
 * Because it has to be reachable from *every* screen — that is the whole point
 * of it: each screen in the redesign has to be checked in both palettes. The
 * rail footer is the only chrome both shells share. It renders outside
 * production only; `paletteSwitchable()` says why.
 */
export function AccountCard({ identity }: { identity: AccountIdentity }) {
  return (
    <div data-testid="account-card" className="flex flex-col gap-2">
      <Link
        href="/app/settings/profile"
        className={cn(
          /*
            The wallet's shape, at the wallet's height. `w-fit` so it hugs the
            identity; `max-w-full` so a long name stops at the rail's edge
            instead of overflowing it, which the truncation below makes safe.
          */
          // The wallet's surface, taken from the same place the wallet takes
          // it since UI-29, so the two controls at the foot of the rail cannot
          // drift apart again — they were two hand-written copies of one pill
          // and this is the third time they have had to be re-synchronised.
          // `h-10` is the wallet's height, said the same way.
          buttonClasses({ variant: "ghost" }),
          "flex h-10 w-fit max-w-full items-center gap-2.5 rounded-full pr-4 pl-1.5",
        )}
      >
        {/*
          The name is right beside it, so the mark is decoration to a screen
          reader. `Avatar`'s label exists for the places it stands alone; here
          it would make the link announce the same name twice before reaching
          the word that says where it goes.
        */}
        <span aria-hidden className="shrink-0">
          <Avatar
            src={identity.avatarUrl}
            initials={identity.initials}
            label={identity.displayName}
            size={28}
          />
        </span>
        {/*
          The name, and nothing under it. The second line said "Founder" on a
          product rail and "GitHub account" on the account one — a constant and
          a fact that Settings → Profile states properly. Neither survives being
          the reason this control is two lines tall beside a one-line balance.
        */}
        <span
          className="text-fg-body min-w-0 truncate text-body font-semibold"
          title={identity.displayName}
        >
          {identity.displayName}
        </span>
      </Link>

      {paletteSwitchable() && <PaletteSwitch deployed={activePalette()} />}
    </div>
  );
}

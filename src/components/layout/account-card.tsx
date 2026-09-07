import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
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
 * ## Why the palette switch stays here
 *
 * Because it has to be reachable from *every* screen — that is the whole point
 * of it: each screen in the redesign has to be checked in both palettes. The
 * rail footer is the only chrome both shells share. It renders outside
 * production only; `paletteSwitchable()` says why.
 */
export function AccountCard({
  identity,
  subtitle,
}: {
  identity: AccountIdentity;
  /** Project rails name the user's role; account rails describe the identity source. */
  subtitle?: string;
}) {
  return (
    <div data-testid="account-card" className="flex flex-col gap-2">
      <Link
        href="/app/settings/profile"
        className={cn(
          "border-line-1 bg-surface-1 rounded-panel flex items-center gap-3 border px-3 py-3",
          "transition-interactive hover:border-line-3 hover:bg-surface-2",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        {/*
          The name is right beside it, so the mark is decoration to a screen
          reader. `Avatar`'s label exists for the places it stands alone; here
          it would make the link announce the same name twice before reaching
          the word that says where it goes.
        */}
        <span aria-hidden>
          <Avatar
            src={identity.avatarUrl}
            initials={identity.initials}
            label={identity.displayName}
            size={38}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="text-fg-body truncate text-body font-semibold"
            title={identity.displayName}
          >
            {identity.displayName}
          </span>
          <span className="text-fg-meta text-caption">
            {subtitle ?? (identity.fromGithub ? "GitHub account" : "Signed in")}
          </span>
        </span>
      </Link>

      {paletteSwitchable() && <PaletteSwitch deployed={activePalette()} />}
    </div>
  );
}

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
 * ## Why the field arrives on hover instead of sitting there
 *
 * This looks like it contradicts `IconButton`, which argues at length that a
 * bare mark with a fill that arrives on hover is not a control on a phone —
 * there is no hover there, so the resting state is the only state a finger
 * ever sees. That argument is about a control whose *container is its whole
 * affordance*: an icon alone says nothing about being pressable.
 *
 * This one is not that. An avatar and a name are self-describing at rest, and
 * every other row in this rail — Nova, Business Health, Products, Billing — is
 * exactly this shape: no container until you hover it. A bordered card at the
 * foot of a rail of borderless rows was the odd one out, and it read as a
 * panel of content rather than as the last row of the navigation.
 *
 * So it inverts, and it inverts *into the rail's own row treatment* rather
 * than into something new. Touch still gets an answer: `active:` is a step
 * past hover, which is what a finger sees when hover never happens.
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
          /*
            Sized to the avatar and the name, not to the rail.
            A full-width field left half of itself empty past the subtitle,
            which reads as a large surface that happens to have a person in
            the corner. `max-w-full` keeps a long name inside the rail, and the
            truncation below is what makes that safe.
          */
          "rounded-nav flex w-fit max-w-full items-center gap-3 px-3 py-3",
          /*
            The container is transparent at rest and arrives on the way in.
            A border that appears rather than one that widens: `transparent`
            holds the pixel, so nothing on the rail shifts when it becomes
            visible.
          */
          "border border-transparent",
          "transition-interactive hover:border-line-2 hover:bg-surface-2",
          // The step past hover, which is the only feedback a finger gets.
          "active:bg-surface-3",
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
        <span className="flex min-w-0 flex-col">
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

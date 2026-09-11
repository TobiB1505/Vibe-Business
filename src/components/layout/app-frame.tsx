import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { AccountCard } from "@/components/layout/account-card";
import { MobileAccount } from "@/components/layout/mobile-account";
import { Wallet } from "@/components/system/wallet";
import { SkeletonBlock } from "@/components/ui/skeleton";
import type { AccountIdentity } from "@/modules/auth/identity-view";
import type { CreditUnits } from "@/modules/credits/units";
import { cn } from "@/lib/utils/cn";
import { activePalette, paletteSwitchable } from "@/app/palette";

/**
 * One rail, for the whole signed-in product (UI-13).
 *
 * ## What was wrong
 *
 * There were two rails. `ProjectSidebar` rendered inside
 * `projects/[projectId]/layout.tsx` and `AccountSidebar` inside
 * `(account)/layout.tsx` — two layouts in two branches of the route tree, so
 * moving between a product and Settings unmounted one whole rail and mounted
 * another. They were also different widths (256px and 280px), which is why the
 * navigation visibly *grew* on the way into Settings and shrank on the way
 * out. A founder read that as the page reloading, because at the level of what
 * is on screen it was: every pixel of the chrome was rebuilt.
 *
 * ## The shape that fixes it
 *
 * The `<aside>` is rendered here, by the one layout both areas share
 * (`src/app/app/layout.tsx`), and it is never rendered anywhere else. Its width
 * and its chrome are therefore properties of the frame rather than of either
 * area, and the two cannot drift apart again — there is nothing left to drift.
 *
 * What changes between areas is only what is *inside* it, delivered by the
 * `@rail` parallel route slot. React keeps this element mounted across that
 * swap, so the rail is literally the same box: it does not re-enter, it does
 * not resize, and the surface beside it follows. That is the whole of the
 * Vercel behaviour this was asked to match — the navigation unfolds in place
 * rather than being replaced.
 *
 * ## Why `empty:hidden` and not a conditional
 *
 * Onboarding, the GitHub connect flow and `/app` itself render no rail: a
 * focused setup flow with a full navigation beside it is an invitation to
 * abandon the flow. Their slot renders nothing, and a layout cannot ask what
 * its slot produced — so the absence is expressed where it is knowable, in CSS,
 * against an element with no children. A conditional would need the layout to
 * know the route, which is exactly the coupling this shape removes.
 */
export function AppFrame({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "text-fg-body flex min-h-dvh flex-col lg:flex-row",
        /*
         * The phone reserves the two bars, and only where there are two bars
         * to reserve (UI-35).
         *
         * `:has()` rather than a prop, for the same reason `empty:hidden`
         * below is CSS: this layout cannot ask what its slot rendered. A
         * focused flow with no rail — onboarding, the GitHub connect — draws
         * no chrome and must not be padded away from the top of the screen as
         * if it had.
         */
        "max-lg:has-[>aside:not(:empty)]:pt-[var(--topbar-h)]",
        "max-lg:has-[>aside:not(:empty)]:pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))]",
      )}
    >
      <aside
        data-testid="app-rail"
        /*
          The hook `theme-v2.css` needs to take the glass off this element
          below `lg`. `.vibe-chrome` paints from a stylesheet rule, so a
          `max-lg:bg-transparent` utility loses to it on specificity — a
          silent loss, which is why the override is written where the paint is
          rather than argued with here.
        */
        data-rail-layer=""
        className={cn(
          "vibe-chrome border-line-1 bg-surface-1 flex shrink-0 flex-col border-b px-4 py-5",
          "gap-[var(--rail-gap)]",
          /*
           * Below `lg` this stops being a box and becomes a *layer*. Its
           * children place themselves — a bar at the top, a bar at the bottom,
           * a control in the corner — so the element itself carries no
           * surface, no border and no padding, and passes taps straight
           * through to the page it covers. Each child turns pointer events
           * back on for itself.
           *
           * A layer rather than three separately-mounted fixed elements
           * because `empty:hidden` is the one thing that decides whether this
           * product has chrome at all, and it can only decide that about one
           * element. Everything mobile lives inside it, so a rail-less route
           * loses the whole of it in one rule, exactly as it always did.
           */
          "max-lg:pointer-events-none max-lg:fixed max-lg:inset-0 max-lg:z-40",
          "max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:gap-0",
          "max-lg:backdrop-blur-none",
          /*
           * Sticky rather than a nested scroller. The account surface already
           * scrolled the document and the workspace scrolled a column inside
           * itself; one rail cannot sit in two scroll models, and this is the
           * one that leaves anchors, `scroll-mt` and browser scroll
           * restoration working on every page.
           */
          "lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:overflow-hidden lg:border-r lg:border-b-0",
          "lg:px-5 lg:py-[var(--frame-inset)]",
          "empty:hidden",
        )}
      >
        {rail}
      </aside>
      {/*
        The column beside the rail. It exists so `children` is a flex item with
        a width: without it, a rail-less route (onboarding, the connect flow)
        is the only child of a row and shrinks to the width of its own content.
      */}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * The lockup, at the top of the rail.
 *
 * It used to be centred inside a box the height of a page heading's first
 * line, so that the mark and the heading beside it read as level. That is a
 * real argument and it produced a worse screen: 44px of the rail's top padding
 * plus a 37px box put the mark 50px down its own surface, floating in the
 * middle of nothing, while the section list below it ran off the bottom of a
 * laptop. A mark that starts at the top of its surface reads as the top of the
 * product, and the alignment it was chasing is between two different columns
 * that do not have to agree.
 *
 * `/app` resolves to whichever product the founder was last in, so the mark is
 * "back to your work" from both rails rather than a trip through an index.
 */
export function RailBrand() {
  return (
    <div
      /* Paired with `theme-v2.css`: glass below `lg`, nothing above it, where
         this sits inside the rail's own frosted surface. */
      data-topbar=""
      className={cn(
        "vibe-chrome flex shrink-0 items-center px-1",
        /*
          Below `lg` the lockup is the top bar (UI-35). It is the only thing in
          it: the product's own name is already the page's breadcrumb and its
          heading, so repeating it here would spend a phone's scarcest measure
          saying something the screen says twice below.

          The safe-area inset is padding rather than height, so `--topbar-h` is
          the bar a founder sees and the notch is not counted as chrome.
        */
        "max-lg:pointer-events-auto max-lg:fixed max-lg:inset-x-0 max-lg:top-0",
        "max-lg:border-line-1 max-lg:border-b",
        "max-lg:h-[calc(var(--topbar-h)+env(safe-area-inset-top))]",
        "max-lg:pt-[env(safe-area-inset-top)] max-lg:px-4",
      )}
    >
      <Link
        href="/app"
        aria-label="Vibe Business — your product"
        /*
          The lockup is 26px of artwork and this is a link people tap. Below
          `lg` the target is the bar's full height, which is the difference
          between a mark you can hit with a thumb and one you have to aim at.
        */
        className="rounded-nav flex items-center max-lg:h-full max-lg:pr-3"
      >
        <VibeLockup />
      </Link>
    </div>
  );
}

/**
 * The part of the rail that changes, and the only part that animates.
 *
 * The brand above and the identity below are identical in both rails and are
 * meant to look continuous through the switch. The navigation between them is
 * the thing that actually changed, so it is the thing that moves: in from the
 * right when Settings unfolds, in from the left on the way back. Twelve pixels
 * and one reveal duration — enough to read as one surface sliding, not enough
 * to be a transition a founder waits through.
 */
export function RailNav({
  direction,
  label,
  children,
}: {
  /** `forward` is deeper into the account; `back` is out towards the product. */
  direction: "forward" | "back";
  label: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      data-rail-direction={direction}
      style={
        { "--vibe-rail-from": direction === "forward" ? "1.25rem" : "-1.25rem" } as CSSProperties
      }
      /*
        The list itself is desktop-only now (UI-35): on a phone these sections
        are the tab bar at the foot of the screen, and drawing both would be
        two navigations for one set of destinations.
      */
      className="vibe-rail-unfold flex min-w-0 flex-col max-lg:hidden lg:min-h-0 lg:flex-1"
    >
      {children}
    </nav>
  );
}

/**
 * The one part of the rail that scrolls.
 *
 * The rail is a full-height column with three parts, and only the middle one
 * is allowed to run out of room: the lockup stays at the top and the identity
 * stays at the bottom whatever the list between them is doing. Before this the
 * whole `<aside>` scrolled, so a product with seven sections and a palette
 * switch pushed its own footer 22px below where Settings put it — a small
 * number that lands on the exact thing the fold is trying to keep still.
 *
 * `lg:` throughout: below it the rail is a strip at the top of the page, the
 * lists scroll sideways, and a vertical scroller inside one would be a second
 * gesture competing with the first.
 *
 * Deliberately *not* wrapped around the project switcher. Its panel is
 * absolutely positioned and an overflow container is a clipping container, so
 * a disclosure inside this would open into a box it has to be scrolled to.
 *
 * ## The fade
 *
 * A clipped row with a hard edge reads as a rendering fault, not as a list
 * that continues — the same defect the horizontal strip has below `lg`, and
 * the same answer. The mask is unconditional and still only ever visible when
 * it is true: the region is a flex child that fills the space left over, so a
 * list that fits ends well above the fading band and nothing is faded.
 */
export function RailScroll({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="rail-scroll"
      className={cn(
        "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain",
        /*
         * Scroll anchoring off, and this is a bug fix rather than a
         * preference. The rail arrives as a skeleton and is replaced by a list
         * of a different height; the browser then adjusts this container's
         * `scrollTop` to keep what was visible visible, which on a navigation
         * list means it silently scrolls *past the first section*. Nova was
         * missing from the rail in production for exactly that reason. A
         * navigation's natural position is its top, always.
         */
        "[overflow-anchor:none]",
        "lg:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)]",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The rail's first frame (UI-14).
 *
 * Reached only when the *area* changes — entering Settings, or coming back —
 * because the navigation is a layout per area and a layout is preserved while
 * its segment holds. Moving between sections of one product never reaches
 * this, which is the whole point of the shape.
 *
 * It draws the real lockup and skeletons for everything below it, at the
 * heights those things actually occupy, so the arriving rail lands on the
 * geometry the skeleton reserved rather than pushing it around. Nothing here
 * animates: a rail that is about to be replaced does not need to perform.
 */
export function RailSkeleton() {
  return (
    <>
      <RailBrand />
      <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
        <SkeletonBlock className="h-9 w-full rounded-nav" />
        <div className="border-line-1 my-2 border-t" />
        <div className="flex flex-col gap-1">
          {[0, 1, 2, 3, 4].map((row) => (
            <SkeletonBlock key={row} className="h-11 w-full rounded-nav" />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-3 lg:pt-[var(--rail-gap)]">
        <SkeletonBlock className="h-10 w-full rounded-full" />
        <SkeletonBlock className="h-14 w-40 rounded-nav" />
      </div>
    </>
  );
}

/**
 * The balance and the identity, pinned to the foot of the rail.
 *
 * One component rather than two identical blocks, because "identical" is what
 * makes the switch invisible and two copies is how identical stops being true.
 * On the phone strip too: the rail's balance used to be `hidden lg:flex`, so a
 * phone showed no balance at all on screens that offer priced actions.
 */
export function RailFooter({
  credits,
  identity,
}: {
  credits: CreditUnits | null;
  identity: AccountIdentity;
}) {
  return (
    <>
      {/*
        The rail's foot, desktop only. On a phone both of these are behind the
        avatar in the corner (UI-35) — not because they matter less, but
        because they are the *account* and the bar at the bottom is the
        product. Stacked into one strip they read as one list, and the balance
        ended up above the founder's own screen.
      */}
      <div className="flex shrink-0 flex-col gap-3 max-lg:hidden lg:pt-[var(--rail-gap)]">
        <Wallet credits={credits} href="/app/settings/billing" />
        <AccountCard identity={identity} />
      </div>
      <MobileAccount
        credits={credits}
        identity={identity}
        palette={paletteSwitchable() ? activePalette() : null}
      />
    </>
  );
}

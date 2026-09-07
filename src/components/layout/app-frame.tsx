import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { VibeLockup } from "@/components/brand/vibe-mark";
import { AccountCard } from "@/components/layout/account-card";
import { Wallet } from "@/components/system/wallet";
import { SkeletonBlock } from "@/components/ui/skeleton";
import type { AccountIdentity } from "@/modules/auth/identity-view";
import type { CreditUnits } from "@/modules/credits/units";
import { cn } from "@/lib/utils/cn";

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
    <div className="text-fg-body flex min-h-dvh flex-col lg:flex-row">
      <aside
        data-testid="app-rail"
        className={cn(
          "vibe-chrome border-line-1 bg-surface-1 flex shrink-0 flex-col gap-7 border-b px-4 py-5",
          /*
           * Sticky rather than a nested scroller. The account surface already
           * scrolled the document and the workspace scrolled a column inside
           * itself; one rail cannot sit in two scroll models, and this is the
           * one that leaves anchors, `scroll-mt` and browser scroll
           * restoration working on every page.
           */
          "lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:overflow-hidden lg:border-r lg:border-b-0",
          "lg:px-5 lg:pt-[var(--shell-top)] lg:pb-7",
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
 * The lockup, in the same box in both rails.
 *
 * Centred inside a box the height of a page heading's first line, so the mark
 * and the heading beside it read as level. Top-aligning their boxes does not
 * do that: a 15px lockup sits near the top of its short line box and a 34px
 * heading sits far down its tall one. The height comes from the type scale
 * (`--shell-heading-line`) and is never nudged.
 *
 * `/app` resolves to whichever product the founder was last in, so the mark is
 * "back to your work" from both rails rather than a trip through an index.
 */
export function RailBrand() {
  return (
    <div className="flex shrink-0 items-center px-1 lg:min-h-[var(--shell-heading-line)]">
      <Link href="/app" className="rounded-nav" aria-label="Vibe Business — your product">
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
      className="vibe-rail-unfold flex min-w-0 flex-col lg:min-h-0 lg:flex-1"
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
        <SkeletonBlock className="h-10 w-full rounded-nav" />
        <div className="border-line-1 my-3 border-t" />
        <div className="flex flex-col gap-1">
          {[0, 1, 2, 3, 4].map((row) => (
            <SkeletonBlock key={row} className="h-11 w-full rounded-nav" />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-3 lg:pt-8">
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
  subtitle,
}: {
  credits: CreditUnits | null;
  identity: AccountIdentity;
  subtitle?: string;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-3 lg:pt-8">
      <Wallet credits={credits} href="/app/settings/billing" />
      <AccountCard identity={identity} subtitle={subtitle} />
    </div>
  );
}

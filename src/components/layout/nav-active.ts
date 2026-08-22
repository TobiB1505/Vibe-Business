/**
 * Which navigation item the current path belongs to (UI-8).
 *
 * Pulled out of `NavList` as a pure function for one reason: the rail lives in
 * a client component whose active state comes from `usePathname`, and the
 * browser harness renders fixtures at `/e2e/…` rather than at real application
 * routes — so an end-to-end test cannot reach this rule. Here it is directly
 * testable, and the component keeps exactly one job.
 *
 * ## The two cases
 *
 * **An index route matches exactly.** `/app` is the account dashboard and also
 * the prefix of `/app/billing`, `/app/projects/…` and everything else; a
 * prefix match would show it as current on every signed-in screen. Same for a
 * project's Overview. That is what `exact` marks.
 *
 * **Everything else matches at a path boundary.** A child route keeps its
 * parent section current — a prepared-change detail page under
 * `/app/projects/x/prepared/…` still lights "Prepared" — but the boundary is a
 * real `/`, so `/prepared` never matches `/prepared-something-else`.
 */
export function isNavItemActive(
  pathname: string,
  item: { href: string; exact?: boolean },
): boolean {
  if (pathname === item.href) return true;
  if (item.exact) return false;
  return pathname.startsWith(`${item.href}/`);
}

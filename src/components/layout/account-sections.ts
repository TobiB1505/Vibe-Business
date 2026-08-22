import type { NavItem } from "./nav-list";

/**
 * The account-level destinations, in navigation order (UI-8).
 *
 * Three, and each is somewhere a founder actually goes: what needs doing, what
 * it costs, and how to add another project. Onboarding is absent on purpose —
 * it is a deliberately distraction-free run and keeps `OnboardingShell`.
 *
 * Its own module, not a constant inside `account-shell.tsx`, so the routing
 * rule can be tested against the real configuration without importing a
 * component that pulls in a Server Action.
 */
export const ACCOUNT_SECTIONS: readonly NavItem[] = [
  // The index route: exact, or it would read as current on every page below it.
  { id: "dashboard", label: "Dashboard", href: "/app", exact: true },
  { id: "billing", label: "Credits", href: "/app/billing" },
  { id: "connect", label: "Connect project", href: "/app/connect/github" },
];

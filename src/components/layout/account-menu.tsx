import Link from "next/link";
import { TextAction } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "@/modules/auth/actions";
import type { AccountIdentity } from "@/modules/auth/identity-view";
import { cn } from "@/lib/utils/cn";

/**
 * The account block at the foot of the rail (CORE-6).
 *
 * ## Why `<details>` rather than a dropdown
 *
 * Because it is a disclosure, and the platform has one. `<details>` opens on
 * click and on Enter, closes on Escape, is in the tab order once, announces its
 * expanded state, and needs no JavaScript at all — so it works on the first
 * paint rather than after hydration. This codebase already made that call for
 * `Disclosure` and `TechnicalDetails`; there is no dropdown primitive here and
 * this is not the feature that should introduce one.
 *
 * The trade-off is honest: it does not close when you click elsewhere. For a
 * menu of three links pinned to the bottom of a rail, that is a smaller cost
 * than a client component and a focus-trap for something the platform does.
 *
 * ## What is in it, and what is not
 *
 * Profile and Billing are real pages. **Settings is deliberately absent.**
 * There is no account-level setting in this product — no preference, no
 * notification, no theme, nothing stored per user but an email and a GitHub
 * connection. A Settings page today would be an empty room with a door on it,
 * and the two things a person might look for there (their identity, their
 * plan) are the two entries that are here. Per-project configuration already
 * has its own Settings inside the project.
 */
export function AccountMenu({ identity }: { identity: AccountIdentity }) {
  return (
    <details className="group border-line-1 border-t pt-3 lg:pt-4">
      <summary
        className={cn(
          "rounded-nav flex cursor-pointer list-none items-center gap-3 px-2 py-2",
          "hover:bg-surface-2 transition-interactive",
        )}
      >
        <Avatar
          src={identity.avatarUrl}
          initials={identity.initials}
          label={identity.displayName}
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-fg-body truncate text-ui" title={identity.displayName}>
            {identity.displayName}
          </span>
          {/*
            What the name above actually is. A GitHub login and an email
            address look different enough to tell apart, and saying which is
            which costs one small line and removes the question.
          */}
          <span className="text-fg-meta text-meta">
            {identity.fromGithub ? "GitHub" : "Signed in"}
          </span>
        </span>
        <span
          aria-hidden
          className="text-fg-meta ml-auto text-xs transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <ul className="mt-1 flex flex-col gap-0.5">
        {[
          { href: "/app/profile", label: "Profile" },
          { href: "/app/billing", label: "Billing" },
        ].map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                "rounded-nav text-fg-secondary hover:bg-surface-2 hover:text-fg-body",
                "block px-3 py-2 text-ui transition-interactive",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
        <li className="px-3 py-2">
          <form action={signOut}>
            <TextAction type="submit" tone="danger" className="text-ui">
              Sign out
            </TextAction>
          </form>
        </li>
      </ul>
    </details>
  );
}

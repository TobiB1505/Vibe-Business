import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import {
  ChevronDownIcon,
  CreditCardIcon,
  SettingsIcon,
  SignOutIcon,
  UserIcon,
} from "@/components/ui/dashboard-icons";
import { cn } from "@/lib/utils/cn";
import { signOut } from "@/modules/auth/actions";
import type { AccountIdentity } from "@/modules/auth/identity-view";

const ACTIONS = [
  {
    href: "/app/profile",
    label: "Profile",
    description: "Manage your profile",
    Icon: UserIcon,
  },
  {
    href: "/app/settings",
    label: "Settings",
    description: "Account and integrations",
    Icon: SettingsIcon,
  },
  {
    href: "/app/billing",
    label: "Billing",
    description: "Credits and plan",
    Icon: CreditCardIcon,
  },
] as const;

function AccountActions() {
  return (
    <div className="flex flex-col gap-1">
      {ACTIONS.map(({ href, label, description, Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "rounded-nav text-fg-secondary hover:bg-surface-hover hover:text-fg-body",
            "flex items-center gap-3 px-3 py-2.5 transition-interactive",
          )}
        >
          <Icon size={19} className="shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="text-fg-body text-sm font-semibold">{label}</span>
            <span className="text-fg-meta hidden text-xs lg:block">{description}</span>
          </span>
        </Link>
      ))}

      <div className="border-line-1 mt-2 border-t pt-2">
        <form action={signOut}>
          <button
            type="submit"
            className={cn(
              "rounded-nav text-coral hover:bg-coral-tint-soft flex w-full items-center gap-3",
              "px-3 py-2.5 text-left text-sm font-semibold transition-interactive",
            )}
          >
            <SignOutIcon size={19} className="shrink-0" />
            <span className="flex flex-col">
              <span>Sign out</span>
              <span className="text-fg-meta hidden text-xs font-normal lg:block">
                Log out of Vibe Business
              </span>
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}

/** Account controls at the foot of the account rail. */
export function AccountMenu({ identity }: { identity: AccountIdentity }) {
  return (
    <details
      data-testid="account-menu"
      className={cn(
        "group border-line-1 border-t pt-3",
        "open:flex open:flex-col-reverse open:gap-3 lg:border-0 lg:pt-0",
      )}
    >
      {/* The identity card is the stable control. Opening it reveals the
          account destinations above it, preserving the reference's layout
          without permanently consuming half of the rail. Native details
          keeps the disclosure keyboard-operable without client state. */}
      <summary
        className={cn(
          "border-line-1 bg-surface-1 rounded-panel flex cursor-pointer list-none items-center gap-3 border",
          "px-3 py-3 transition-interactive hover:bg-surface-2",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <Avatar
          src={identity.avatarUrl}
          initials={identity.initials}
          label={identity.displayName}
          size={38}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="text-fg-body truncate text-sm font-semibold"
            title={identity.displayName}
          >
            {identity.displayName}
          </span>
          <span className="text-fg-meta text-xs">
            {identity.fromGithub ? "GitHub account" : "Signed in"}
          </span>
        </span>
        <ChevronDownIcon
          size={16}
          className="text-fg-meta shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="border-line-2 bg-surface-2 rounded-panel border p-2 shadow-panel">
        <AccountActions />
      </div>
    </details>
  );
}

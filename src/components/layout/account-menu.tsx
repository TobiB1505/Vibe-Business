import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import {
  ChevronDownIcon,
  CreditCardIcon,
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
    href: "/app/billing",
    label: "Billing",
    description: "Credits and plan",
    Icon: CreditCardIcon,
  },
] as const;

function AccountActions({ compact = false }: { compact?: boolean }) {
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
            {!compact && <span className="text-fg-meta text-xs">{description}</span>}
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
              {!compact && (
                <span className="text-fg-meta text-xs font-normal">Log out of Vibe Business</span>
              )}
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
    <>
      {/* The reference keeps the useful account destinations visible. On a
          desktop rail there is enough space for that, and hiding them behind
          a disclosure makes a frequent destination feel like a secret. */}
      <div className="hidden flex-col gap-3 lg:flex">
        <div className="border-line-2 bg-surface-2 rounded-panel border p-2 shadow-panel">
          <AccountActions />
        </div>

        <div className="border-line-1 bg-surface-1 rounded-panel flex items-center gap-3 border px-3 py-3">
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
          <ChevronDownIcon size={16} className="text-fg-meta rotate-180" />
        </div>
      </div>

      {/* Below `lg` the rail is a strip. A persistent action card would turn
          that strip into half the screen, so the same destinations collapse
          into the platform disclosure that was here before. */}
      <details className="group border-line-1 border-t pt-3 lg:hidden">
        <summary className="rounded-nav hover:bg-surface-2 flex cursor-pointer list-none items-center gap-3 px-2 py-2 transition-interactive">
          <Avatar
            src={identity.avatarUrl}
            initials={identity.initials}
            label={identity.displayName}
          />
          <span className="text-fg-body min-w-0 flex-1 truncate text-sm font-semibold">
            {identity.displayName}
          </span>
          <ChevronDownIcon
            size={16}
            className="text-fg-meta transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="pt-2">
          <AccountActions compact />
        </div>
      </details>
    </>
  );
}

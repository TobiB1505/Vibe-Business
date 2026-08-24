import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import {
  CreditCardIcon,
  RepositoriesIcon,
  UserIcon,
} from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { requireSession } from "@/modules/auth/session";

export const metadata = { title: "Settings" };

const SETTINGS = [
  {
    title: "Profile",
    description: "Review the email and GitHub identity Vibe uses for your account.",
    href: "/app/profile",
    action: "Manage profile",
    external: false,
    Icon: UserIcon,
  },
  {
    title: "GitHub access",
    description: "Manage the repositories and organisations available to Vibe on GitHub.",
    href: "https://github.com/settings/installations",
    action: "Manage on GitHub",
    external: true,
    Icon: RepositoriesIcon,
  },
  {
    title: "Billing",
    description: "Review your credit balance, plan and billing options.",
    href: "/app/billing",
    action: "Manage billing",
    external: false,
    Icon: CreditCardIcon,
  },
] as const;

/**
 * The account settings index intentionally contains only controls that exist.
 * Preferences with no storage or behaviour would be decorative form fields;
 * profile, GitHub access and billing are the three real account settings Vibe
 * can hand a person to today.
 */
export default async function SettingsPage() {
  await requireSession("/app/settings");

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title="Settings"
        description="Manage your account, connected GitHub access and billing."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {SETTINGS.map(({ title, description, href, action, external, Icon }) => (
          <Surface
            key={title}
            level="panel"
            padding="md"
            className="flex min-h-56 flex-col items-start gap-5"
          >
            <span className="bg-mint-tint-soft text-mint rounded-nav flex size-11 items-center justify-center">
              <Icon size={21} />
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <h2 className="text-fg text-title font-bold">{title}</h2>
              <p className="text-fg-muted text-sm leading-6">{description}</p>
            </div>
            <Link
              href={href}
              {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              {action}
            </Link>
          </Surface>
        ))}
      </div>
    </div>
  );
}

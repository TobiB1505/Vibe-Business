import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import {
  CodeIcon,
  CreditCardIcon,
  RepositoriesIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/dashboard-icons";
import { StatusDot, StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import type { AccountIdentity } from "@/modules/auth/identity-view";
import type { AccountProfileOverview } from "@/modules/auth/profile-overview";

type ProfileViewProps = AccountProfileOverview & {
  identity: AccountIdentity;
  email: string | null;
  githubLogin: string | null;
};

function DetailRow({
  icon,
  label,
  description,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <div className="border-line-2 grid gap-3 border-b py-4 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(12rem,0.9fr)] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="text-fg-secondary mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <dt className="text-fg-body text-sm font-semibold">{label}</dt>
          <p className="text-fg-muted mt-0.5 text-xs leading-5">{description}</p>
        </div>
      </div>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 pl-8 text-sm sm:justify-start sm:pl-0">
        <span className="text-fg-body min-w-0 break-words">{value}</span>
        {status}
      </dd>
    </div>
  );
}

function CountValue({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-fg-muted text-sm">Not available</span>
  ) : (
    <span className="text-fg text-2xl font-bold tabular-nums">{value}</span>
  );
}

/** The account profile composition, separated so browser fixtures render it verbatim. */
export function ProfileView({
  identity,
  email,
  githubLogin,
  productCount,
  repositoryCount,
}: ProfileViewProps) {
  return (
    <div className="flex flex-col gap-5 sm:gap-6" data-testid="account-profile">
      <SectionHeader
        level={1}
        title="Account Profile"
        description="Your identity, connected account and workspace at a glance."
      />

      <Surface
        level="card"
        padding="lg"
        as="section"
        aria-labelledby="profile-identity-heading"
        className="relative overflow-hidden"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-5 sm:gap-7">
            <div className="relative shrink-0">
              <Avatar
                src={identity.avatarUrl}
                initials={identity.initials}
                label={identity.displayName}
                size={88}
                className="ring-line-strong"
              />
              <span className="bg-app absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-full">
                <StatusDot tone={githubLogin ? "success" : "neutral"} />
              </span>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="profile-identity-heading" className="text-fg text-2xl font-bold">
                  {identity.displayName}
                </h2>
                <StatusPill tone="neutral">Account owner</StatusPill>
              </div>
              <p className="text-fg-muted mt-2 break-all text-sm">
                {email ?? "No email available"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <CodeIcon size={18} className="text-fg-secondary" />
                <span className="text-fg-body">
                  {githubLogin ? `@${githubLogin}` : "GitHub not connected"}
                </span>
                <StatusPill tone={githubLogin ? "success" : "waiting"} className="px-2.5 py-0.5">
                  {githubLogin ? "Connected" : "Not connected"}
                </StatusPill>
              </div>
            </div>
          </div>

          <Link
            href={githubLogin ? "https://github.com/settings/installations" : "/app/connect/github"}
            {...(githubLogin ? { target: "_blank", rel: "noreferrer noopener" } : {})}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            {githubLogin ? "Manage GitHub" : "Connect GitHub"}
          </Link>
        </div>
      </Surface>

      <Surface
        level="panel"
        padding="md"
        as="section"
        aria-labelledby="personal-information-heading"
      >
        <h2 id="personal-information-heading" className="text-fg mb-5 text-sm font-bold">
          Personal information
        </h2>
        <dl>
          <DetailRow
            icon={<UserIcon size={19} />}
            label="Account name"
            description={
              githubLogin
                ? "Your connected GitHub username is the name Vibe shows."
                : "Vibe uses your full email address until GitHub is connected."
            }
            value={identity.displayName}
          />
          <DetailRow
            icon={<CreditCardIcon size={19} />}
            label="Email address"
            description="Used for signing in to your Vibe account."
            value={email ?? "Not available"}
          />
          <DetailRow
            icon={<CodeIcon size={19} />}
            label="GitHub username"
            description="The GitHub identity connected to Vibe."
            value={githubLogin ? `@${githubLogin}` : "Not connected"}
            status={
              githubLogin ? (
                <StatusPill tone="success" className="px-2.5 py-0.5">
                  Connected
                </StatusPill>
              ) : undefined
            }
          />
        </dl>
      </Surface>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Surface
          level="panel"
          padding="md"
          as="section"
          aria-labelledby="connected-accounts-heading"
          className="flex flex-col"
        >
          <h2 id="connected-accounts-heading" className="text-fg mb-5 text-sm font-bold">
            Connected accounts
          </h2>
          <div className="flex flex-1 flex-col justify-between gap-5">
            <div className="flex items-center gap-4">
              <span className="border-line-3 bg-surface-hover text-fg flex size-10 shrink-0 items-center justify-center rounded-full border">
                <CodeIcon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-fg-body text-sm font-semibold">GitHub</p>
                <p className="text-fg-muted truncate text-xs">
                  {githubLogin ? `@${githubLogin}` : "No account connected"}
                </p>
              </div>
              <StatusPill tone={githubLogin ? "success" : "waiting"} className="px-2.5 py-0.5">
                {githubLogin ? "Connected" : "Not connected"}
              </StatusPill>
            </div>
            <Link
              href={
                githubLogin ? "https://github.com/settings/installations" : "/app/connect/github"
              }
              {...(githubLogin ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              {githubLogin ? "Manage connection" : "Connect GitHub"}
            </Link>
          </div>
        </Surface>

        <Surface level="panel" padding="md" as="section" aria-labelledby="workspace-heading">
          <h2 id="workspace-heading" className="text-fg mb-5 text-sm font-bold">
            Your workspace
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="border-line-2 bg-well rounded-well border p-4">
              <span className="bg-mint-tint-soft text-mint mb-4 flex size-9 items-center justify-center rounded-full">
                <UserIcon size={18} />
              </span>
              <CountValue value={productCount} />
              <p className="text-fg-muted mt-1 text-xs">Products</p>
            </div>
            <div className="border-line-2 bg-well rounded-well border p-4">
              <span className="bg-mint-tint-soft text-mint mb-4 flex size-9 items-center justify-center rounded-full">
                <RepositoriesIcon size={18} />
              </span>
              <CountValue value={repositoryCount} />
              <p className="text-fg-muted mt-1 text-xs">Repositories</p>
            </div>
          </div>
          <Link
            href="/app/products"
            className="text-mint hover:text-mint-hover mt-5 inline-flex rounded-sm text-sm font-semibold transition-interactive"
          >
            Go to my products{" "}
            <span aria-hidden className="ml-2">
              →
            </span>
          </Link>
        </Surface>
      </div>

      <Surface level="section" padding="md" as="section" aria-labelledby="account-controls-heading">
        <h2 id="account-controls-heading" className="text-fg mb-5 text-sm font-bold">
          Account controls
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/app/settings"
            className="border-line-2 hover:border-line-strong hover:bg-surface-hover rounded-well flex items-center gap-4 border p-4 transition-interactive"
          >
            <SettingsIcon size={21} className="text-fg-secondary" />
            <span>
              <span className="text-fg-body block text-sm font-semibold">Account settings</span>
              <span className="text-fg-muted mt-1 block text-xs">Privacy and account deletion</span>
            </span>
          </Link>
          <Link
            href="/app/billing"
            className="border-line-2 hover:border-line-strong hover:bg-surface-hover rounded-well flex items-center gap-4 border p-4 transition-interactive"
          >
            <CreditCardIcon size={21} className="text-fg-secondary" />
            <span>
              <span className="text-fg-body block text-sm font-semibold">Billing</span>
              <span className="text-fg-muted mt-1 block text-xs">Credits, plans and payments</span>
            </span>
          </Link>
        </div>
      </Surface>
    </div>
  );
}

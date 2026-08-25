import type { SVGProps } from "react";

export type DashboardIconName =
  | "home"
  | "products"
  | "repositories"
  | "business-health"
  | "action-plan"
  | "agent"
  | "settings"
  | "experiments"
  | "team";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconFrame({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9.2V21h13V9.2" />
      <path d="M9.5 21v-6.5h5V21" />
    </IconFrame>
  );
}

export function ProductsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4z" />
      <path d="m4.3 7.6 7.7 4.5 7.7-4.5M12 12.1v8.7" />
    </IconFrame>
  );
}

export function RepositoriesIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3.2" />
      <path d="M4.5 5.5v6c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2v-6" />
      <path d="M4.5 11.5v6c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2v-6" />
    </IconFrame>
  );
}

export function ExperimentsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M9 3h6M10 3v5l-5.6 9.3A2.4 2.4 0 0 0 6.5 21h11a2.4 2.4 0 0 0 2.1-3.7L14 8V3" />
      <path d="M7.4 16h9.2" />
    </IconFrame>
  );
}

export function TeamIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.2A5.5 5.5 0 0 1 9 13.3a5.5 5.5 0 0 1 5.5 5.5V20" />
      <path d="M16 5.3a3 3 0 0 1 0 5.4M17 14a5.5 5.5 0 0 1 3.5 5.1V20" />
    </IconFrame>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M4.5 21v-1.5a7.5 7.5 0 0 1 15 0V21" />
    </IconFrame>
  );
}

export function CreditCardIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 9.5h18M7 15h3" />
    </IconFrame>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </IconFrame>
  );
}

export function BusinessHealthIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M9.1 4.1A3.4 3.4 0 0 0 5.8 7.5v.7a3.6 3.6 0 0 0-1.8 6.7v.6A3.5 3.5 0 0 0 7.5 19H9V4.1Z" />
      <path d="M14.9 4.1a3.4 3.4 0 0 1 3.3 3.4v.7a3.6 3.6 0 0 1 1.8 6.7v.6a3.5 3.5 0 0 1-3.5 3.5H15V4.1Z" />
      <path d="M9 8H7.2M15 8h1.8M9 12H6.8M15 12h2.2M9 16H7.2M15 16h1.8M12 4v16" />
    </IconFrame>
  );
}

export function ActionPlanIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 6h10M4 12h16M4 18h12" />
      <circle cx="17" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="19" cy="18" r="2" />
    </IconFrame>
  );
}

export function AgentIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="4" y="7" width="16" height="13" rx="3" />
      <path d="M12 3v4M9 3h6M8.5 12h.01M15.5 12h.01M8.5 16h7" />
    </IconFrame>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M14 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3" />
      <path d="M10 12h11m-4-4 4 4-4 4" />
    </IconFrame>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m7 10 5 5 5-5" />
    </IconFrame>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m10 7 5 5-5 5" />
    </IconFrame>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M20 12H4m6-6-6 6 6 6" />
    </IconFrame>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m5 12.5 4.2 4.2L19 7" />
    </IconFrame>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </IconFrame>
  );
}

export function RocketIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M14.5 5.5c-3.2 1-5.6 3.5-6.6 6.6l4 4c3.1-1 5.6-3.4 6.6-6.6L20 4l-5.5 1.5Z" />
      <path d="m8.2 11.8-3.5.7L3 15l4.2.4M12.2 15.8l-.7 3.5L9 21l-.4-4.2" />
      <circle cx="14.8" cy="9.2" r="1.6" />
      <path d="M5 19c1.1-2.1 2.3-2.8 4-3" />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 4v16M4 12h16" />
    </IconFrame>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8V17M12 7.3h.01" />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </IconFrame>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3.5 5h17l-6.4 7.2v5.6l-4.2 2.1v-7.7z" />
    </IconFrame>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m4 16 5-5 3 3 7-7" />
      <path d="M15 7h4v4" />
    </IconFrame>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M10.1 4.4 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.9 4.4a2.2 2.2 0 0 0-3.8 0Z" />
      <path d="M12 9v5M12 17.5h.01" />
    </IconFrame>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21M12 3C9.7 5.5 8.5 8.5 8.5 12s1.2 6.5 3.5 9" />
    </IconFrame>
  );
}

export function CodeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14" />
    </IconFrame>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="5" y="10" width="14" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </IconFrame>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="7" cy="5" r="2" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="7" cy="19" r="2" />
      <path d="M7 7v10M9 11h3a5 5 0 0 0 5-2" />
    </IconFrame>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </IconFrame>
  );
}

export function PaletteIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3a9 9 0 1 0 0 18h1.3a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3H18A3 3 0 0 0 21 11.3 9 9 0 0 0 12 3Z" />
      <circle cx="7.5" cy="10" r=".8" />
      <circle cx="10" cy="6.8" r=".8" />
      <circle cx="14" cy="6.8" r=".8" />
      <circle cx="16.8" cy="10" r=".8" />
    </IconFrame>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3c.6 3.5 2.5 5.4 6 6-3.5.6-5.4 2.5-6 6-.6-3.5-2.5-5.4-6-6 3.5-.6 5.4-2.5 6-6Z" />
      <path d="M18.5 15.5c.25 1.6 1.1 2.45 2.5 2.75-1.4.3-2.25 1.15-2.5 2.75-.25-1.6-1.1-2.45-2.5-2.75 1.4-.3 2.25-1.15 2.5-2.75Z" />
    </IconFrame>
  );
}

export function DashboardIcon({ name, ...props }: IconProps & { name: DashboardIconName }) {
  const Icon = {
    home: HomeIcon,
    products: ProductsIcon,
    repositories: RepositoriesIcon,
    "business-health": BusinessHealthIcon,
    "action-plan": ActionPlanIcon,
    agent: AgentIcon,
    settings: SettingsIcon,
    experiments: ExperimentsIcon,
    team: TeamIcon,
  }[name];

  return <Icon {...props} />;
}

import type { SVGProps } from "react";

export type DashboardIconName =
  | "home"
  | "products"
  | "repositories"
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

export function DashboardIcon({ name, ...props }: IconProps & { name: DashboardIconName }) {
  const Icon = {
    home: HomeIcon,
    products: ProductsIcon,
    repositories: RepositoriesIcon,
    experiments: ExperimentsIcon,
    team: TeamIcon,
  }[name];

  return <Icon {...props} />;
}

import type { ReactNode } from "react";
import { RailBrand } from "@/components/layout/app-frame";
import { RailAccountFooter } from "../rail-account-footer";
import { SettingsRailSlot } from "../settings-rail";

/**
 * The account's rail, as a layout (UI-14).
 *
 * Same reason as the product's: a layout is preserved while its segment holds,
 * so moving between General, Products, Repositories, Billing and Profile
 * re-renders a `null` page underneath a rail that never moves. The active row
 * comes from `usePathname`, so it keeps up on the client.
 */
export default function SettingsRailLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <RailBrand />
      <SettingsRailSlot />
      <RailAccountFooter />
      {children}
    </>
  );
}

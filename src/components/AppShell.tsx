"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TrialBanner from "./TrialBanner";
import SelfUpdateBanner from "./SelfUpdateBanner";

const NO_SHELL_PATHS = ["/login", "/setup"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (NO_SHELL_PATHS.includes(pathname) || pathname.startsWith("/store")) {
    return <>{children}</>;
  }
  return (
    <div className="flex flex-1 flex-col">
      <TrialBanner />
      <SelfUpdateBanner />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <Sidebar />
        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

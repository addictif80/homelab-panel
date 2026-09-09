"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

const NO_SHELL_PATHS = ["/login", "/setup"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (NO_SHELL_PATHS.includes(pathname) || pathname.startsWith("/store")) {
    return <>{children}</>;
  }
  return (
    <div className="flex flex-1">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}

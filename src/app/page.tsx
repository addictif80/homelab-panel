import { DashboardGrid } from "@/components/dashboard/DashboardGrid";

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title text-xl">Vue d&apos;ensemble</h1>
        <p className="page-subtitle">Panneau de contrôle centralisé du homelab.</p>
      </div>
      <DashboardGrid />
    </div>
  );
}

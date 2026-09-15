"use client";

import DetectionThresholdsPanel from "@/components/DetectionThresholdsPanel";
import NotificationScheduleSettingsPanel from "@/components/NotificationScheduleSettingsPanel";
import SmtpSettingsPanel from "@/components/SmtpSettingsPanel";
import NotificationChannelsPanel from "@/components/NotificationChannelsPanel";
import CertificateWatchPanel from "@/components/CertificateWatchPanel";
import TrustedDevicesPanel from "@/components/TrustedDevicesPanel";
import OllamaSettingsPanel from "@/components/OllamaSettingsPanel";
import PortAuditPanel from "@/components/PortAuditPanel";
import RecoveryVaultPanel from "@/components/RecoveryVaultPanel";
import LockdownPanel from "@/components/LockdownPanel";
import DirectorySettingsPanel from "@/components/DirectorySettingsPanel";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Réglages du panel</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Notifications, sensibilité de détection, appareils de confiance, assistant IA et autres réglages
          transverses. Les alertes et analyses en direct restent dans le{" "}
          <a href="/security" className="text-blue-400 hover:underline">Centre de sécurité</a>.
        </p>
      </div>

      <div className="space-y-3">
        <LockdownPanel />
        <DetectionThresholdsPanel />
        <PortAuditPanel />
        <RecoveryVaultPanel />
        <SmtpSettingsPanel />
        <NotificationChannelsPanel />
        <NotificationScheduleSettingsPanel />
        <CertificateWatchPanel />
        <TrustedDevicesPanel />
        <OllamaSettingsPanel />
        <DirectorySettingsPanel />
      </div>
    </div>
  );
}

"use client";

import DetectionThresholdsPanel from "@/components/DetectionThresholdsPanel";
import NotificationScheduleSettingsPanel from "@/components/NotificationScheduleSettingsPanel";
import SmtpSettingsPanel from "@/components/SmtpSettingsPanel";
import NotificationChannelsPanel from "@/components/NotificationChannelsPanel";
import CertificateWatchPanel from "@/components/CertificateWatchPanel";
import DomainRegistrationPanel from "@/components/DomainRegistrationPanel";
import TrustedContactPanel from "@/components/TrustedContactPanel";
import TrustedDevicesPanel from "@/components/TrustedDevicesPanel";
import AiProviderSelector from "@/components/AiProviderSelector";
import OllamaSettingsPanel from "@/components/OllamaSettingsPanel";
import OneMinSettingsPanel from "@/components/OneMinSettingsPanel";
import PortAuditPanel from "@/components/PortAuditPanel";
import RecoveryVaultPanel from "@/components/RecoveryVaultPanel";
import LockdownPanel from "@/components/LockdownPanel";
import DirectorySettingsPanel from "@/components/DirectorySettingsPanel";
import LicensePanel from "@/components/LicensePanel";
import MailLogSourcesPanel from "@/components/MailLogSourcesPanel";
import SettingsSection from "@/components/SettingsSection";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Réglages du panel</h1>
        <p className="page-subtitle max-w-3xl">
          Notifications, sensibilité de détection, appareils de confiance, assistant IA et autres réglages
          transverses. Les alertes et analyses en direct restent dans le{" "}
          <a href="/security" className="text-blue-400 hover:underline">
            Centre de sécurité
          </a>
          .
        </p>
      </div>

      <SettingsSection icon="🔑" title="Licence">
        <LicensePanel />
      </SettingsSection>

      <SettingsSection
        icon="🤖"
        title="Assistant IA"
        description="Chat et pilotage par langage naturel — auto-hébergé (Ollama) ou cloud (1min.ai)."
      >
        <AiProviderSelector />
        <OllamaSettingsPanel />
        <OneMinSettingsPanel />
      </SettingsSection>

      <SettingsSection
        icon="🛡️"
        title="Sécurité & accès"
        description="Détection, blocage réseau, coffre-fort de récupération et dispositifs de confiance."
      >
        <LockdownPanel />
        <DetectionThresholdsPanel />
        <PortAuditPanel />
        <RecoveryVaultPanel />
        <TrustedContactPanel />
        <TrustedDevicesPanel />
      </SettingsSection>

      <SettingsSection
        icon="🔔"
        title="Notifications"
        description="Email (SMTP), canaux multiples (webhook, ntfy, Discord, Slack) et planification des alertes."
      >
        <SmtpSettingsPanel />
        <NotificationChannelsPanel />
        <NotificationScheduleSettingsPanel />
      </SettingsSection>

      <SettingsSection icon="🌐" title="Domaines & certificats" description="Expiration SSL et renouvellement des noms de domaine.">
        <CertificateWatchPanel />
        <DomainRegistrationPanel />
      </SettingsSection>

      <SettingsSection icon="📋" title="Annuaire & journaux" description="Visibilité publique des services et sources de logs mail.">
        <DirectorySettingsPanel />
        <MailLogSourcesPanel />
      </SettingsSection>
    </div>
  );
}

import { AlertsWidget, MachinesWidget, ResourcesWidget } from "./widgets/ResourceWidgets";
import { QuickAccessWidget } from "./widgets/QuickAccessWidget";
import { DockerWidget, ProxmoxWidget, UpdatesWidget } from "./widgets/InfraWidgets";
import { BlockedIpsWidget, LockdownWidget, MailEventsWidget, SecurityFindingsWidget } from "./widgets/SecurityWidgets";
import { BackupsWidget, CertificatesWidget, MaintenanceWidget, UptimeWidget } from "./widgets/ReliabilityWidgets";
import { PublicIpWidget, TailscaleWidget } from "./widgets/NetworkWidgets";
import { AuditWidget } from "./widgets/AuditWidget";
import { LicenseWidget } from "./widgets/LicenseWidget";
import { NotesWidget } from "./widgets/NotesWidget";
import { LogsWidget } from "./widgets/LogsWidget";

/** id -> component, keyed exactly like WIDGET_CATALOG in lib/dashboardWidgets.ts. Kept separate
 * from that catalog because this file pulls in every widget's React component (and everything
 * they import) — the catalog itself stays a plain data module the layout API route can also use. */
export const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  resources: ResourcesWidget,
  machines: MachinesWidget,
  alerts: AlertsWidget,
  quickAccess: QuickAccessWidget,
  docker: DockerWidget,
  proxmox: ProxmoxWidget,
  securityFindings: SecurityFindingsWidget,
  blockedIps: BlockedIpsWidget,
  mailEvents: MailEventsWidget,
  lockdown: LockdownWidget,
  backups: BackupsWidget,
  certificates: CertificatesWidget,
  uptime: UptimeWidget,
  maintenance: MaintenanceWidget,
  updates: UpdatesWidget,
  tailscale: TailscaleWidget,
  publicIp: PublicIpWidget,
  audit: AuditWidget,
  license: LicenseWidget,
  notes: NotesWidget,
  logs: LogsWidget,
};

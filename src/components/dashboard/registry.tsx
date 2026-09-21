import { AlertsWidget, MachinesWidget, ResourcesWidget } from "./widgets/ResourceWidgets";
import { QuickAccessWidget } from "./widgets/QuickAccessWidget";
import { DockerWidget, ElectricityCostWidget, ProxmoxWidget, UpdatesWidget } from "./widgets/InfraWidgets";
import { BlockedIpsWidget, LockdownWidget, MailEventsWidget, SecurityFindingsWidget } from "./widgets/SecurityWidgets";
import { BackupRule321Widget, BackupsWidget, CertificatesWidget, MaintenanceWidget, UptimeWidget } from "./widgets/ReliabilityWidgets";
import { IspOutagesWidget, PublicIpWidget, TailscaleWidget } from "./widgets/NetworkWidgets";
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
  electricityCost: ElectricityCostWidget,
  securityFindings: SecurityFindingsWidget,
  blockedIps: BlockedIpsWidget,
  mailEvents: MailEventsWidget,
  lockdown: LockdownWidget,
  backups: BackupsWidget,
  backupRule321: BackupRule321Widget,
  certificates: CertificatesWidget,
  uptime: UptimeWidget,
  maintenance: MaintenanceWidget,
  updates: UpdatesWidget,
  tailscale: TailscaleWidget,
  publicIp: PublicIpWidget,
  ispOutages: IspOutagesWidget,
  audit: AuditWidget,
  license: LicenseWidget,
  notes: NotesWidget,
  logs: LogsWidget,
};

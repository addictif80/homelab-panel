export type Severity = "critical" | "warning" | "info" | "good";

export type FindingCategory = "ssh" | "firewall" | "updates" | "accounts" | "network" | "docker";

export type Finding = {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  detail: string;
  /** Present when a safe, one-click remediation exists. */
  fixId?: string;
  fixLabel?: string;
  /** Shown in the confirmation step when the fix carries some risk worth flagging plainly. */
  fixWarning?: string;
  /** Extra arguments a parameterized fix needs (e.g. which IP to block). */
  fixParams?: Record<string, string>;
  /** Commands to run by hand on the host, shown when there's no safe one-click fix. */
  howTo?: string[];
  /** Set by the scan layer when this finding was dismissed by the user. */
  ignored?: boolean;
};

export type HostScanResult = {
  hostId: number;
  hostName: string;
  hostKind: string;
  hostOs: string | null;
  findings: Finding[];
  error?: string;
};

export type HostFacts = Record<string, string>;

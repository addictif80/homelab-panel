import { randomUUID } from "crypto";
import { getSetting, setSetting } from "./db";

export type LogCategory = "web-access" | "web-error" | "mail";

export type LogSource = {
  id: string;
  hostId: number;
  hostName: string;
  containerId: string;
  containerName: string;
  /** Path to a log file inside the container (e.g. NPM's per-host logs). Empty = container stdout/stderr. */
  filePath: string | null;
  label: string;
  category: LogCategory;
};

const SETTING_KEY = "log_sources";

export function listLogSources(): LogSource[] {
  const raw = getSetting(SETTING_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function addLogSource(source: Omit<LogSource, "id">): LogSource {
  const sources = listLogSources();
  const created: LogSource = { ...source, id: randomUUID() };
  sources.push(created);
  setSetting(SETTING_KEY, JSON.stringify(sources));
  return created;
}

export function removeLogSource(id: string): void {
  const sources = listLogSources().filter((s) => s.id !== id);
  setSetting(SETTING_KEY, JSON.stringify(sources));
}

export function getLogSource(id: string): LogSource | undefined {
  return listLogSources().find((s) => s.id === id);
}

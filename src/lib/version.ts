import { readFileSync } from "fs";
import path from "path";

let cached: string | null = null;

/** The version a client instance reports is whatever was in package.json's "version" field the
 * moment the seller generated its export zip — the seller bumps it before each release. */
export function getCurrentVersion(): string {
  if (cached) return cached;
  try {
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    cached = JSON.parse(raw).version || "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached!;
}

/** Simple numeric semver compare (no pre-release tags) — returns true if `a` is newer than `b`. */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na > nb;
  }
  return false;
}

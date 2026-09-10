import { ZipArchive } from "archiver";
import { createWriteStream, readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Directories excluded wholesale (not explored at all — more correct and far faster than
// filtering individual files, especially for node_modules).
const SKIP_DIRS = [
  "node_modules",
  ".git",
  ".next",
  "data",
  "src/app/store",
  "src/app/seller",
  "src/app/api/store",
  "src/app/api/seller",
  "src/app/api/download",
  "src/lib/seller",
];

// Everything seller-only (payment, download delivery, the landing page, the URSSAF report) is
// excluded via SKIP_DIRS above; these are individual files that must never ship either.
// license.json is excluded from the plain glob because it's re-written below with this
// specific export's real trial length / activation key instead of the repo's placeholder.
const IGNORE_FILES = [".env", ".env.local", ".env*.local", "license.json"];

export type ExportLicenseConfig = {
  trialDays: number;
  licenseServerUrl: string;
  /** Present only for a paid download — the app auto-activates with it on first boot. */
  preActivatedKey?: string;
};

/** Zips the project source (minus seller-only code, secrets, and build artifacts) into a temp
 * file and returns its path — caller is responsible for deleting it (and its parent temp dir)
 * once the response has been sent. */
export async function buildClientArchive(license: ExportLicenseConfig): Promise<{ zipPath: string; cleanup: () => void }> {
  const projectRoot = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), "homelab-panel-export-"));
  const zipPath = path.join(dir, "homelab-panel.zip");

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);

    archive.glob("**/*", {
      cwd: projectRoot,
      dot: true,
      skip: SKIP_DIRS,
      ignore: IGNORE_FILES,
      nodir: false,
    });

    archive.append(JSON.stringify(license, null, 2), { name: "license.json" });

    archive.finalize();
  });

  return { zipPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function readArchive(zipPath: string): Buffer {
  return readFileSync(zipPath);
}

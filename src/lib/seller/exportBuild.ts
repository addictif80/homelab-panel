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

// lib/demo/ + app/demo/ (the public sales-demo sandbox) are deliberately NOT in SKIP_DIRS, unlike
// the seller-only dirs above: they hold no real secrets or seller infrastructure info (only
// fictitious seed data), and Turbopack's production bundler — confirmed by actually building a
// customer export and running `next build` against it, not just `tsc --noEmit` — fails outright on
// a conditional require() whose target file doesn't exist at all, even when the branch that calls
// it is unreachable at runtime (env-gated). Shipping the files and gating purely on SELLER_MODE at
// runtime (the route 404s, isDemoContext() can never be true) avoids that failure mode entirely.
// Everything seller-only (payment, download delivery, the landing page, the URSSAF report) is
// excluded via SKIP_DIRS above; these are individual files that must never ship either.
// license.json is excluded from the plain glob because it's re-written below with this
// specific export's real trial length / activation key instead of the repo's placeholder.
// src/lib/seed.ts holds the seller's own real hardware names, LAN IPs and network topology (dev/
// demo convenience, gated behind SELLER_MODE in db.ts) — excluding the file itself, not just its
// effect, means a buyer reading their own source can't see the seller's home network layout.
// src/lib/license.ts is excluded from the plain glob because isSellerInstance() inside it is
// patched below — an env-var check in code that ships to a customer's own server can never be a
// real protection (they control their own environment), so the shipped copy has it hardcoded to
// `false` instead of reading SELLER_MODE at all.
// src/lib/db.ts and src/lib/directorySubmission.ts are excluded from the plain glob for the same
// reason as license.ts: each contains a require() of a path that genuinely doesn't exist in a
// customer export (./seed, ./seller/directory) — Turbopack's production bundler fails the build
// on an unresolvable require() target even when the branch calling it is unreachable at runtime
// (confirmed by actually building a customer export and running `next build`, not just
// `tsc --noEmit`, against it), so the call itself has to be gone from the shipped file, not just
// dead code. Patched below, alongside license.ts.
const IGNORE_FILES = [
  ".env",
  ".env.local",
  ".env*.local",
  "license.json",
  "src/lib/seed.ts",
  "src/lib/license.ts",
  "src/lib/db.ts",
  "src/lib/directorySubmission.ts",
];

const SELLER_INSTANCE_CHECK = `export function isSellerInstance(): boolean {\n  return process.env.SELLER_MODE === "true";\n}`;
const SELLER_INSTANCE_DISABLED = `export function isSellerInstance(): boolean {\n  // Hardcoded false in every customer export (see lib/seller/exportBuild.ts) — never a runtime\n  // env-var check here, since a customer controls their own server's environment entirely.\n  return false;\n}`;

/** Neutralizes isSellerInstance() for a customer export — see the IGNORE_FILES comment above.
 * Throws rather than silently shipping a bypassable copy if the source no longer matches exactly
 * (e.g. the function was edited and this patch fell out of sync). */
function patchLicenseFileForExport(projectRoot: string): string {
  const source = readFileSync(path.join(projectRoot, "src/lib/license.ts"), "utf8");
  const occurrences = source.split(SELLER_INSTANCE_CHECK).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Impossible de sécuriser l'export : isSellerInstance() introuvable ou dupliquée dans license.ts (${occurrences} correspondance(s)).`
    );
  }
  return source.replace(SELLER_INSTANCE_CHECK, SELLER_INSTANCE_DISABLED);
}

const SEED_REQUIRE_BLOCK = `    if (process.env.SELLER_MODE === "true") {
      // Lazy import avoids a circular dependency (seed.ts calls back into getDb()).
      require("./seed").seedIfEmpty();
    }`;

/** Removes db.ts's require("./seed") call for a customer export — seed.ts (the seller's own real
 * hardware inventory) is excluded from the export entirely, and the require target genuinely not
 * existing fails Turbopack's build even though SELLER_MODE is always false there anyway. */
function patchDbFileForExport(projectRoot: string): string {
  const source = readFileSync(path.join(projectRoot, "src/lib/db.ts"), "utf8");
  const occurrences = source.split(SEED_REQUIRE_BLOCK).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Impossible de sécuriser l'export : bloc seed.ts introuvable ou dupliqué dans db.ts (${occurrences} correspondance(s)).`);
  }
  return source.replace(SEED_REQUIRE_BLOCK, "");
}

const SUBMIT_SELLER_BRANCH = `  if (isSellerInstance()) {
    const { upsertDirectorySubmission } = require("./seller/directory") as SellerDirectoryModule;
    const submission = upsertDirectorySubmission({ ...SELLER_SUBMISSION_IDENTITY, ...input });
    return { ok: true, submissionId: submission.id, status: "pending" };
  }
`;
const WITHDRAW_SELLER_BRANCH = `  if (isSellerInstance()) {
    const { withdrawDirectorySubmission } = require("./seller/directory") as SellerDirectoryModule;
    withdrawDirectorySubmission(submissionId, SELLER_SUBMISSION_IDENTITY.licenseKey, SELLER_SUBMISSION_IDENTITY.instanceId);
    return;
  }
`;

/** Removes directorySubmission.ts's two require("./seller/directory") calls for a customer
 * export — same reasoning as patchDbFileForExport above. isSellerInstance() is already hardcoded
 * false in every export (see patchLicenseFileForExport), so these branches are dead code there;
 * the require target just also has to not exist in the shipped source for Turbopack to build it. */
function patchDirectorySubmissionFileForExport(projectRoot: string): string {
  const source = readFileSync(path.join(projectRoot, "src/lib/directorySubmission.ts"), "utf8");
  const submitCount = source.split(SUBMIT_SELLER_BRANCH).length - 1;
  const withdrawCount = source.split(WITHDRAW_SELLER_BRANCH).length - 1;
  if (submitCount !== 1 || withdrawCount !== 1) {
    throw new Error(
      `Impossible de sécuriser l'export : branche(s) seller introuvable(s) ou dupliquée(s) dans directorySubmission.ts (submit: ${submitCount}, withdraw: ${withdrawCount}).`
    );
  }
  return source.replace(SUBMIT_SELLER_BRANCH, "").replace(WITHDRAW_SELLER_BRANCH, "");
}

export type ExportLicenseConfig = {
  trialDays: number;
  licenseServerUrl: string;
  /** Public half of the seller's Ed25519 signing keypair — lets the client verify an activation
   * certificate locally without being able to forge one (the private key never ships). */
  licensePublicKey: string;
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
    archive.append(patchLicenseFileForExport(projectRoot), { name: "src/lib/license.ts" });
    archive.append(patchDbFileForExport(projectRoot), { name: "src/lib/db.ts" });
    archive.append(patchDirectorySubmissionFileForExport(projectRoot), { name: "src/lib/directorySubmission.ts" });

    archive.finalize();
  });

  return { zipPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function readArchive(zipPath: string): Buffer {
  return readFileSync(zipPath);
}

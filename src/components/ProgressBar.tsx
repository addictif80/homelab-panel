"use client";

/**
 * The one progress-bar visual used everywhere a long-running action runs — copy/transfer,
 * backup/restore, dump/import, migration, Docker redeploys. Determinate (a real percentage) only
 * when the caller actually knows a total ahead of time; otherwise indeterminate (animated
 * stripes), never a fabricated number. See lib/jobs.ts's setJobProgress for why.
 */
export default function ProgressBar({
  status,
  current,
  total,
}: {
  status: "running" | "success" | "failed";
  current?: number | null;
  total?: number | null;
}) {
  const determinate = status === "running" && typeof current === "number" && typeof total === "number" && total > 0;
  const percent = determinate ? Math.min(100, Math.max(0, Math.round((current! / total!) * 100))) : null;

  const trackClass =
    status === "success"
      ? "bg-emerald-900/30"
      : status === "failed"
        ? "bg-red-900/30"
        : "bg-neutral-800";

  const fillClass =
    status === "success"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : "bg-gradient-to-r from-blue-600 to-fuchsia-600";

  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full ${trackClass}`}
      role="progressbar"
      aria-valuenow={percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-busy={status === "running"}
    >
      {status === "running" && !determinate ? (
        <div
          className="h-full w-full rounded-full animate-[progress-stripe_1s_linear_infinite]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,.35) 0 7px, transparent 7px 14px), linear-gradient(135deg, var(--color-blue-600), var(--accent-2))",
            backgroundSize: "28px 28px",
          }}
        />
      ) : (
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${fillClass}`}
          style={{ width: `${percent ?? 100}%` }}
        />
      )}
    </div>
  );
}

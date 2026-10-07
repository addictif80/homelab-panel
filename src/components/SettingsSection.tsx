/** Groups a handful of related settings panels under a labeled heading — breaks up what used to
 * be one long undifferentiated list of ~17 identical accordions into a few scannable categories.
 * Purely presentational: each panel inside still manages its own state/fetching as before. */
export default function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="icon-chip h-9 w-9 bg-blue-950/40 text-base text-blue-300">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          {description && <p className="text-xs text-neutral-500">{description}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

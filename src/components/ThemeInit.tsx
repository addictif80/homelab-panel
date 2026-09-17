// Runs before paint (blocking, in <head>) so the correct theme applies on first frame instead
// of flashing light-then-dark. Kept as a tiny inline script rather than a client component,
// since a client component still renders after hydration — too late to avoid the flash.
// Light is the CSS base (bare :root, no attribute needed) and the app's default regardless of OS
// preference — dark only applies once the user has explicitly toggled to it (persisted below by
// ThemeToggle), by adding data-theme="dark".
const THEME_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem("theme") === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) {}
})();
`;

export default function ThemeInit() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

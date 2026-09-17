// Runs before paint (blocking, in <head>) so the correct theme applies on first frame instead
// of flashing dark-then-light. Kept as a tiny inline script rather than a client component,
// since a client component still renders after hydration — too late to avoid the flash.
// Light is the default regardless of OS preference — dark only applies once the user has
// explicitly toggled to it (persisted below by ThemeToggle).
const THEME_SCRIPT = `
(function () {
  function applyLight() { document.documentElement.setAttribute("data-theme", "light"); }
  try {
    if (localStorage.getItem("theme") !== "dark") applyLight();
  } catch (e) {
    applyLight();
  }
})();
`;

export default function ThemeInit() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

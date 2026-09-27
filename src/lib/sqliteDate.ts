/** SQLite's `datetime('now')` (used everywhere this panel stamps a row with the current UTC time)
 * formats as `YYYY-MM-DD HH:MM:SS` — a space between date and time, not the `T` ISO 8601 requires.
 * Appending `Z` straight onto that (`` `${value}Z` ``, the pattern this replaces) produces a string
 * that *looks* like it should parse as UTC but isn't strictly conforming — browsers are inconsistent
 * about it, and at least one real-world case here showed it silently parsed as *local* time instead,
 * displaying every timestamp on the page two hours off (exactly the CEST/UTC gap) despite the
 * server's own clock being perfectly correct. Swapping the space for a `T` first makes the string
 * unambiguous ISO 8601 UTC, parsed the same way everywhere. */
export function parseSqliteUtc(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

// Strict calendar dates in the form YYYY-MM-DD.
//
// Dates are handled as whole days in UTC so that time zones and daylight saving
// can never shift a day count.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a YYYY-MM-DD string into a day number (days since 1970-01-01).
 * Returns null for anything that is not a string in that exact form or is not a
 * real calendar date (for example 2026-02-30).
 */
export function parseDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;

  const date = new Date(0);
  // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999.
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null; // the day rolled over into the next month, so it does not exist
  }
  return Math.round(date.getTime() / MS_PER_DAY);
}

export function isValidDate(value: unknown): value is string {
  return parseDate(value) !== null;
}

const FAMILY_TIMEZONE = "Asia/Shanghai";

/**
 * Maps a UTC instant to the family calendar date in Asia/Shanghai (YYYY-MM-DD).
 */
export function toFamilyDate(utc: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: FAMILY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(utc);
}

export function familyTimezone(): string {
  return FAMILY_TIMEZONE;
}

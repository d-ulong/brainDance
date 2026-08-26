/**
 * Adds calendar days to a family date (YYYY-MM-DD) without timezone or millisecond arithmetic.
 */
export function addFamilyDays(familyDate: string, days: number): string {
  const [year, month, day] = familyDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);

  const resultYear = utcDate.getUTCFullYear();
  const resultMonth = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const resultDay = String(utcDate.getUTCDate()).padStart(2, "0");

  return `${resultYear}-${resultMonth}-${resultDay}`;
}

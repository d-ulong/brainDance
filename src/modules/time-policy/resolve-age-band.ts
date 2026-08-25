import { familyTimezone } from "@/modules/time-policy/to-family-date";

export type AgeBand = "5-8" | "9-12" | "13-18";

export function resolveAgeBand(birthDate: Date, referenceDate: Date = new Date()): AgeBand {
  const ageYears = ageInYearsAt(birthDate, referenceDate);
  if (ageYears <= 8) {
    return "5-8";
  }
  if (ageYears <= 12) {
    return "9-12";
  }
  return "13-18";
}

function ageInYearsAt(birthDate: Date, referenceDate: Date): number {
  const birthParts = datePartsInFamilyTz(birthDate);
  const refParts = datePartsInFamilyTz(referenceDate);

  let age = refParts.year - birthParts.year;
  const beforeBirthday =
    refParts.month < birthParts.month ||
    (refParts.month === birthParts.month && refParts.day < birthParts.day);

  if (beforeBirthday) {
    age -= 1;
  }

  return age;
}

function datePartsInFamilyTz(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: familyTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

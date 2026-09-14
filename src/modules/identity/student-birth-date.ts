import { IdentityError } from "./errors";
import { ageInYearsAt } from "@/modules/time-policy/resolve-age-band";

export function assertStudentBirthDate(birthDate: string, minimum: number, maximum: number): void {
  const parsed = new Date(`${birthDate}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== birthDate
  ) {
    throw new IdentityError("VALIDATION_ERROR", "请填写有效的出生日期");
  }
  const age = ageInYearsAt(parsed);
  if (age < minimum || age > maximum) {
    throw new IdentityError("VALIDATION_ERROR", `此注册方式适用于 ${minimum}–${maximum} 岁学生`);
  }
}

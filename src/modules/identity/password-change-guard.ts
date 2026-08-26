import { IdentityError } from "@/modules/identity/errors";

export function assertStudentMayPerformWrites(user: { mustChangePassword: boolean }): void {
  if (user.mustChangePassword) {
    throw new IdentityError(
      "PASSWORD_CHANGE_REQUIRED",
      "Password change required before this action",
    );
  }
}

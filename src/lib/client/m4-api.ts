import { apiFetch, newIdempotencyKey } from "@/lib/client/api";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export type DailyReflectionDto = {
  reflectionId: string;
  studentId: string;
  familyDate: string;
  visibility: "normal" | "private";
  body: string;
  currentVersion: number;
  updatedAt: string;
  idempotentReplay?: boolean;
};

export type ReflectionGrantDto = {
  parentId: string;
  displayName: string;
  grantedAt: string;
};

export type ReflectionGrantsResponse = {
  grants: ReflectionGrantDto[];
  eligibleParents: Array<{ parentId: string; displayName: string }>;
};

export function todayFamilyDate(): string {
  return toFamilyDate();
}

export async function fetchDailyReflection(
  studentId: string,
  familyDate: string = todayFamilyDate(),
): Promise<DailyReflectionDto> {
  return apiFetch<DailyReflectionDto>(`/api/students/${studentId}/daily-reflections/${familyDate}`);
}

export async function upsertDailyReflection(input: {
  studentId: string;
  body: string;
  visibility: "normal" | "private";
  familyDate?: string;
}): Promise<DailyReflectionDto> {
  const familyDate = input.familyDate ?? todayFamilyDate();
  return apiFetch<DailyReflectionDto>(
    `/api/students/${input.studentId}/daily-reflections/${familyDate}`,
    {
      method: "PUT",
      body: JSON.stringify({
        body: input.body,
        visibility: input.visibility,
        idempotencyKey: newIdempotencyKey("reflection-upsert"),
      }),
    },
  );
}

export async function deleteDailyReflection(
  studentId: string,
  familyDate: string = todayFamilyDate(),
): Promise<{ reflectionId: string; deleted: true; idempotentReplay: boolean }> {
  return apiFetch(`/api/students/${studentId}/daily-reflections/${familyDate}`, {
    method: "DELETE",
    body: JSON.stringify({ idempotencyKey: newIdempotencyKey("reflection-delete") }),
  });
}

export async function fetchReflectionGrants(
  studentId: string,
  familyDate: string = todayFamilyDate(),
): Promise<ReflectionGrantsResponse> {
  return apiFetch<ReflectionGrantsResponse>(
    `/api/students/${studentId}/daily-reflections/${familyDate}/grants`,
  );
}

export async function grantReflectionAccess(input: {
  studentId: string;
  parentId: string;
  familyDate?: string;
}): Promise<{ grantId: string; parentId: string; idempotentReplay: boolean }> {
  const familyDate = input.familyDate ?? todayFamilyDate();
  return apiFetch(`/api/students/${input.studentId}/daily-reflections/${familyDate}/grants`, {
    method: "POST",
    body: JSON.stringify({
      parentId: input.parentId,
      idempotencyKey: newIdempotencyKey("reflection-grant"),
    }),
  });
}

export async function revokeReflectionAccess(input: {
  studentId: string;
  parentId: string;
  familyDate?: string;
}): Promise<{ grantId: string | null; parentId: string; idempotentReplay: boolean }> {
  const familyDate = input.familyDate ?? todayFamilyDate();
  return apiFetch(
    `/api/students/${input.studentId}/daily-reflections/${familyDate}/grants/${input.parentId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ idempotencyKey: newIdempotencyKey("reflection-revoke") }),
    },
  );
}

export function reflectionVisibilityLabel(visibility: "normal" | "private"): string {
  return visibility === "private" ? "私密" : "普通";
}

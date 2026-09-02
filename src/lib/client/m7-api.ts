import { apiFetch, newIdempotencyKey } from "@/lib/client/api";

export type MediaAttachmentDto = {
  referenceId: string;
  mediaId: string;
  purpose: string;
  status: string;
  detectedMime: string | null;
  width: number | null;
  height: number | null;
};

export type FamilyPushDto = {
  pushId: string;
  studentId: string;
  creatorParentId: string;
  status: string;
  currentVersion: number;
  body: string;
  linkUrl: string | null;
  media: MediaAttachmentDto[];
  scheduledPublishAt: string | null;
  publishedAt: string | null;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  idempotentReplay?: boolean;
};

export type PushAnswerDto = {
  answerId: string;
  pushId: string;
  studentId: string;
  currentVersion: number;
  body: string;
  media: MediaAttachmentDto[];
  updatedAt: string;
  idempotentReplay?: boolean;
};

export type PushCommentDto = {
  commentId: string;
  pushId: string;
  authorId: string;
  parentCommentId: string | null;
  currentVersion: number;
  body: string | null;
  deleted: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  idempotentReplay?: boolean;
};

export type MediaObjectDto = {
  mediaId: string;
  status: string;
  declaredMime: string;
  detectedMime: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  readyAt: string | null;
  idempotentReplay?: boolean;
};

export function familyPushStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "scheduled":
      return "已预约";
    case "published":
      return "已发布";
    case "disabled":
      return "已停用";
    case "deleted":
      return "已删除";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export async function listParentPushes(studentId: string) {
  return apiFetch<{ pushes: FamilyPushDto[] }>(`/api/family/students/${studentId}/pushes`);
}

export async function listStudentPushes() {
  return apiFetch<{ pushes: FamilyPushDto[] }>("/api/student/pushes");
}

export async function getPush(studentId: string, pushId: string) {
  return apiFetch<FamilyPushDto>(`/api/family/students/${studentId}/pushes/${pushId}`);
}

export async function createPush(
  studentId: string,
  body: {
    body?: string;
    linkUrl?: string;
    mediaIds?: string[];
    publishMode: "draft" | "immediate" | "scheduled";
    scheduledPublishAt?: string | null;
  },
) {
  return apiFetch<FamilyPushDto>(`/api/family/students/${studentId}/pushes`, {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey("create-push") },
    body: JSON.stringify(body),
  });
}

export async function editPush(
  studentId: string,
  pushId: string,
  body: {
    body?: string;
    linkUrl?: string;
    mediaIds?: string[];
    scheduledPublishAt?: string | null;
  },
) {
  return apiFetch<FamilyPushDto>(`/api/family/students/${studentId}/pushes/${pushId}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": newIdempotencyKey("edit-push") },
    body: JSON.stringify(body),
  });
}

export async function transitionPush(
  studentId: string,
  pushId: string,
  action: "publish" | "cancel" | "disable",
) {
  return apiFetch<FamilyPushDto>(`/api/family/students/${studentId}/pushes/${pushId}/${action}`, {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey(`${action}-push`) },
    body: JSON.stringify({}),
  });
}

export async function deletePush(studentId: string, pushId: string) {
  return apiFetch<FamilyPushDto>(`/api/family/students/${studentId}/pushes/${pushId}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": newIdempotencyKey("delete-push") },
  });
}

export async function getAnswer(studentId: string, pushId: string) {
  return apiFetch<{ answer: PushAnswerDto | null }>(
    `/api/family/students/${studentId}/pushes/${pushId}/answers`,
  );
}

export async function submitAnswer(
  studentId: string,
  pushId: string,
  body: {
    body?: string;
    mediaIds?: string[];
    handwritingMediaIds?: string[];
  },
) {
  return apiFetch<PushAnswerDto>(`/api/family/students/${studentId}/pushes/${pushId}/answers`, {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey("submit-answer") },
    body: JSON.stringify(body),
  });
}

export async function uploadMedia(
  studentId: string,
  file: File,
  declaredMime: string,
): Promise<MediaObjectDto> {
  const form = new FormData();
  form.append("file", file);
  form.append("declaredMime", declaredMime);
  return apiFetch<MediaObjectDto>(`/api/family/students/${studentId}/media`, {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey("upload-media") },
    body: form,
  });
}

export async function issueMediaCapability(studentId: string, referenceId: string) {
  return apiFetch<{
    capabilityToken: string;
    expiresAt: string;
    mediaId: string;
    referenceId: string;
  }>(`/api/family/students/${studentId}/media/references/${referenceId}/capability`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchMediaBytes(capabilityToken: string): Promise<Blob> {
  const response = await fetch("/api/media/read", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capabilityToken }),
  });
  if (!response.ok) {
    throw new Error("Failed to load media");
  }
  return response.blob();
}

export async function listComments(studentId: string, pushId: string) {
  return apiFetch<{ comments: PushCommentDto[] }>(
    `/api/family/students/${studentId}/pushes/${pushId}/comments`,
  );
}

export async function createComment(
  studentId: string,
  pushId: string,
  body: string,
  parentCommentId?: string | null,
) {
  return apiFetch<PushCommentDto>(`/api/family/students/${studentId}/pushes/${pushId}/comments`, {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey("create-comment") },
    body: JSON.stringify({ body, parentCommentId: parentCommentId ?? null }),
  });
}

export async function editComment(
  studentId: string,
  pushId: string,
  commentId: string,
  body: string,
) {
  return apiFetch<PushCommentDto>(
    `/api/family/students/${studentId}/pushes/${pushId}/comments/${commentId}`,
    {
      method: "PATCH",
      headers: { "Idempotency-Key": newIdempotencyKey("edit-comment") },
      body: JSON.stringify({ action: "edit", body }),
    },
  );
}

export async function deleteComment(studentId: string, pushId: string, commentId: string) {
  return apiFetch<PushCommentDto>(
    `/api/family/students/${studentId}/pushes/${pushId}/comments/${commentId}`,
    {
      method: "PATCH",
      headers: { "Idempotency-Key": newIdempotencyKey("delete-comment") },
      body: JSON.stringify({ action: "delete" }),
    },
  );
}

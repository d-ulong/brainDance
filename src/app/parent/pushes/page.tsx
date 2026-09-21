"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { PushDeliveryThread } from "@/components/family-content/push-delivery-thread";
import { MediaPreviewList } from "@/components/family-content/media-preview";
import { VideoLinkPreview } from "@/components/family-content/video-link-preview";
import { Modal } from "@/components/ui/modal";
import {
  Field,
  LoadingState,
  PageShell,
  PrimaryButton,
  SecondaryButton,
  TextInput,
  Toast,
} from "@/components/ui/page-shell";
import { StudentMultiSelect } from "@/components/ui/student-multi-select";
import { StudentManagementTabs } from "@/components/ui/student-management-tabs";
import { StudentContextBanner } from "@/components/ui/student-context-banner";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  fetchPushLibrary,
  publishPushLibraryEntry,
  savePushLibraryEntry,
  type LinkedStudentDto,
  type PushLibraryEntryDto,
} from "@/lib/client/m2-api";
import { editPush, getPush, uploadMedia, type FamilyPushDto } from "@/lib/client/m7-api";
import { MAX_PUSH_IMAGES } from "@/modules/family-content/constants";

export default function ParentPushLibraryPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<PushLibraryEntryDto[]>([]);
  const [students, setStudents] = useState<LinkedStudentDto[]>([]);
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [tags, setTags] = useState("");
  const [answerDisclosureDays, setAnswerDisclosureDays] = useState("");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [clearExistingImages, setClearExistingImages] = useState(false);
  const [filterStudentId, setFilterStudentId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterThrough, setFilterThrough] = useState("");
  const [filterTags, setFilterTags] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PushLibraryEntryDto | null>(null);
  const [viewing, setViewing] = useState<PushLibraryEntryDto | null>(null);
  const [addingRecipients, setAddingRecipients] = useState<PushLibraryEntryDto | null>(null);
  const [additionalRecipientIds, setAdditionalRecipientIds] = useState<string[]>([]);
  const [additionalImageFiles, setAdditionalImageFiles] = useState<File[]>([]);
  const [detailPush, setDetailPush] = useState<FamilyPushDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const reportError = useCallback((message: string) => setError(message), []);
  const load = useCallback(async () => {
    const response = await fetchPushLibrary();
    setEntries(response.entries);
    setStudents(response.students);
  }, []);
  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") return router.replace("/login");
      try {
        const params = new URLSearchParams(window.location.search);
        const initialStudentId = params.get("studentId") ?? "";
        const initialPushId = params.get("pushId") ?? "";
        const response = await fetchPushLibrary(
          initialStudentId ? { studentId: initialStudentId } : undefined,
        );
        setEntries(response.entries);
        setStudents(response.students);
        setFilterStudentId(initialStudentId);
        if (initialPushId) {
          setViewing(
            response.entries.find((entry) =>
              entry.deliveries.some((delivery) => delivery.pushId === initialPushId),
            ) ?? null,
          );
        }
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "加载推送失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);
  useEffect(() => {
    let active = true;
    setDetailPush(null);
    const deliveries = viewing?.deliveries ?? [];
    if (!deliveries.length)
      return () => {
        active = false;
      };
    void Promise.all(deliveries.map((delivery) => getPush(delivery.studentId, delivery.pushId)))
      .then((pushes) => {
        if (active)
          setDetailPush(pushes.find((push) => push.media.length > 0) ?? pushes[0] ?? null);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof ApiError ? cause.message : "无法加载推送附件");
      });
    return () => {
      active = false;
    };
  }, [viewing]);
  function chooseImages(files: FileList | null, apply: (files: File[]) => void) {
    const selected = Array.from(files ?? []);
    if (selected.length > MAX_PUSH_IMAGES) {
      setError(`一次最多选择 ${MAX_PUSH_IMAGES} 张图片`);
      return;
    }
    apply(selected);
  }
  async function uploadImages(studentId: string, files: File[]) {
    const ids: string[] = [];
    for (const file of files) {
      const mime = file.type === "image/jpg" ? "image/jpeg" : file.type || "image/jpeg";
      const uploaded = await uploadMedia(studentId, file, mime);
      if (uploaded.status !== "ready") throw new Error("图片处理未完成");
      ids.push(uploaded.mediaId);
    }
    return ids;
  }
  function resetForm() {
    setBody("");
    setLinkUrl("");
    setTags("");
    setAnswerDisclosureDays("");
    setImageFiles([]);
    setClearExistingImages(false);
    setRecipientIds([]);
    setEditing(null);
  }
  function openNewPush() {
    resetForm();
    setFormOpen(true);
  }
  function openEditPush(entry: PushLibraryEntryDto) {
    setEditing(entry);
    setBody(entry.body);
    setLinkUrl(entry.linkUrl ?? "");
    setTags(entry.tags.join(", "));
    setAnswerDisclosureDays(
      entry.answerDisclosureDays === null ? "" : String(entry.answerDisclosureDays),
    );
    setImageFiles([]);
    setClearExistingImages(false);
    setRecipientIds([]);
    setFormOpen(true);
  }
  async function saveAndPublish(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const result = await savePushLibraryEntry({
        entryId: editing?.id,
        revision: editing?.revision,
        body,
        linkUrl: linkUrl || null,
        tags: tags
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        answerDisclosureDays: answerDisclosureDays === "" ? null : Number(answerDisclosureDays),
      });
      if (imageFiles.length && !recipientIds.length && !editing?.deliveries.length)
        throw new Error("草稿图片需要先选择接收学生，以建立私有访问授权");
      if (editing?.deliveries.length) {
        for (const delivery of editing.deliveries) {
          const current = await getPush(delivery.studentId, delivery.pushId);
          if (!current.canEdit || !["draft", "scheduled", "published"].includes(current.status))
            continue;
          const mediaIds = imageFiles.length
            ? await uploadImages(delivery.studentId, imageFiles)
            : clearExistingImages
              ? []
              : current.media.map((media) => media.mediaId);
          await editPush(delivery.studentId, delivery.pushId, {
            body,
            linkUrl: linkUrl || undefined,
            mediaIds,
          });
        }
      }
      if (recipientIds.length) {
        const mediaIdsByStudent: Record<string, string[]> = {};
        if (imageFiles.length) {
          for (const studentId of recipientIds) {
            mediaIdsByStudent[studentId] = await uploadImages(studentId, imageFiles);
          }
        }
        await publishPushLibraryEntry({
          entryId: result.entry.id,
          revision: result.entry.revision,
          studentIds: recipientIds,
          publishMode: "immediate",
          mediaIdsByStudent,
        });
        setMessage(`推送已发布给 ${recipientIds.length} 名学生`);
      } else setMessage(editing ? "推送内容已更新" : "内容已保存为草稿");
      setFormOpen(false);
      resetForm();
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "保存推送失败",
      );
    } finally {
      setSaving(false);
    }
  }
  async function applyFilters() {
    try {
      const response = await fetchPushLibrary({
        studentId: filterStudentId || undefined,
        from: filterFrom || undefined,
        through: filterThrough || undefined,
        tags: filterTags
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setEntries(response.entries);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "筛选推送失败");
    }
  }
  async function addRecipients() {
    if (!addingRecipients || !additionalRecipientIds.length) return;
    setSaving(true);
    setError(null);
    try {
      const mediaIdsByStudent: Record<string, string[]> = {};
      if (additionalImageFiles.length) {
        for (const studentId of additionalRecipientIds) {
          mediaIdsByStudent[studentId] = await uploadImages(studentId, additionalImageFiles);
        }
      }
      await publishPushLibraryEntry({
        entryId: addingRecipients.id,
        revision: addingRecipients.revision,
        studentIds: additionalRecipientIds,
        publishMode: "immediate",
        mediaIdsByStudent,
      });
      setMessage(`已追加推送给 ${additionalRecipientIds.length} 名学生`);
      setAddingRecipients(null);
      setAdditionalRecipientIds([]);
      setAdditionalImageFiles([]);
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "追加学生失败",
      );
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <PageShell title="家长推送">
        <LoadingState />
      </PageShell>
    );
  return (
    <PageShell
      title="家长推送"
      subtitle="推送先保存为内容，再选择接收学生；学生作答彼此独立"
      showLogout
      hideHeading
    >
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={message} onClose={() => setMessage(null)} />
      <section className="bd-library-toolbar">
        <div className="bd-library-toolbar-copy">
          <h2>推送列表</h2>
          <p>可按学生、日期和标签查询已有推送。</p>
        </div>
        <StudentManagementTabs />
        <PrimaryButton
          type="button"
          fullWidth={false}
          data-testid="push-library-create"
          onClick={openNewPush}
        >
          新增推送
        </PrimaryButton>
      </section>
      {filterStudentId ? (
        <StudentContextBanner studentId={filterStudentId} label="正在查看推送的学生" />
      ) : null}
      <section className="bd-filter-panel" aria-label="推送筛选">
        <div className="bd-filter-fields">
          <select
            className="min-h-11 rounded-2xl border p-2"
            aria-label="按学生筛选"
            value={filterStudentId}
            onChange={(event) => setFilterStudentId(event.target.value)}
          >
            <option value="">全部学生</option>
            {students.map((student) => (
              <option key={student.studentId} value={student.studentId}>
                {student.displayName || student.username || "未命名学生"}
              </option>
            ))}
          </select>
          <TextInput
            type="date"
            aria-label="开始日期"
            value={filterFrom}
            onChange={(event) => setFilterFrom(event.target.value)}
          />
          <TextInput
            type="date"
            aria-label="结束日期"
            value={filterThrough}
            onChange={(event) => setFilterThrough(event.target.value)}
          />
          <TextInput
            aria-label="按标签筛选"
            value={filterTags}
            onChange={(event) => setFilterTags(event.target.value)}
            placeholder="标签，逗号分隔"
          />
        </div>
        <div className="bd-filter-actions">
          <PrimaryButton type="button" fullWidth={false} onClick={() => void applyFilters()}>
            应用筛选
          </PrimaryButton>
          <SecondaryButton
            onClick={() => {
              setFilterStudentId("");
              setFilterFrom("");
              setFilterThrough("");
              setFilterTags("");
              void load();
            }}
          >
            清空
          </SecondaryButton>
        </div>
      </section>
      <section>
        {entries.length ? (
          <ul className="bd-push-library-grid">
            {entries.map((entry) => (
              <li className="bd-push-library-card" key={entry.id} onClick={() => setViewing(entry)}>
                <div className="bd-library-card-head">
                  <p className="bd-library-card-title">{entry.body || "仅链接推送"}</p>
                  <span
                    className="bd-library-count"
                    title={
                      entry.deliveries.length
                        ? entry.deliveries
                            .map((delivery) => {
                              const student = students.find(
                                (item) => item.studentId === delivery.studentId,
                              );
                              return student?.displayName || student?.username || "未命名学生";
                            })
                            .join("、")
                        : "尚未推送给学生"
                    }
                  >
                    {entry.deliveries.length} 人
                  </span>
                </div>
                <p className="bd-library-summary">
                  {entry.tags.map((tag) => `#${tag}`).join(" ") || "无标签"} · 已投递{" "}
                  {entry.deliveries.length} 人
                </p>
                <div className="bd-library-actions" onClick={(event) => event.stopPropagation()}>
                  <PrimaryButton type="button" fullWidth={false} onClick={() => setViewing(entry)}>
                    查看
                  </PrimaryButton>
                  <SecondaryButton onClick={() => openEditPush(entry)}>编辑</SecondaryButton>
                  <SecondaryButton
                    onClick={() => {
                      setAddingRecipients(entry);
                      setAdditionalRecipientIds([]);
                      setAdditionalImageFiles([]);
                    }}
                  >
                    添加学生
                  </SecondaryButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-3xl border border-dashed p-6 text-center text-sm text-neutral-600">
            暂无推送内容，点击“新增推送”开始创建。
          </p>
        )}
      </section>
      {formOpen ? (
        <Modal
          title={editing ? "编辑推送" : "新增推送"}
          onClose={() => {
            setFormOpen(false);
            resetForm();
          }}
        >
          <form className="space-y-3" onSubmit={saveAndPublish}>
            <Field label="内容">
              <textarea
                className="min-h-28 w-full rounded-2xl border p-3"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <Field label="链接（可选）">
              <TextInput
                type="url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
              />
            </Field>
            <Field label="标签（逗号分隔）">
              <TextInput
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="阅读, 作业"
              />
            </Field>
            <Field label="学生作答公开天数（可选）">
              <TextInput
                type="number"
                min={0}
                max={365}
                value={answerDisclosureDays}
                onChange={(event) => setAnswerDisclosureDays(event.target.value)}
                placeholder="不填则立即向其他学生公开"
              />
            </Field>
            <Field label="图片（可选，0–5 张；每张 JPG/PNG/WebP，≤10MB）">
              <input
                className="min-h-11 w-full"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => chooseImages(event.target.files, setImageFiles)}
              />
              {imageFiles.length ? (
                <span className="text-xs text-slate-500">已选择 {imageFiles.length} 张</span>
              ) : null}
            </Field>
            {editing?.deliveries.length ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clearExistingImages}
                  disabled={imageFiles.length > 0}
                  onChange={(event) => setClearExistingImages(event.target.checked)}
                />
                移除已有图片（重新选择图片时会替换）
              </label>
            ) : null}
            <Field
              label={
                editing ? "追加接收学生（可多选，可不选）" : "接收学生（可多选；不选则保存草稿）"
              }
            >
              <StudentMultiSelect
                students={
                  editing
                    ? students.filter(
                        (student) =>
                          !editing.deliveries.some(
                            (delivery) => delivery.studentId === student.studentId,
                          ),
                      )
                    : students
                }
                selectedIds={recipientIds}
                onChange={setRecipientIds}
                emptyLabel={editing ? "不追加学生，仅更新已有推送" : "不选择学生，保存为草稿"}
              />
            </Field>
            <p className="text-xs text-neutral-600">
              图片会为每位接收学生分别上传和授权；编辑已发布推送会生成新版本并保留历史。
            </p>
            <PrimaryButton type="submit" disabled={saving} data-testid="push-library-save">
              {saving
                ? "保存中…"
                : recipientIds.length
                  ? editing
                    ? "保存并发布更新"
                    : "保存并发布"
                  : editing
                    ? "保存修改"
                    : "保存草稿"}
            </PrimaryButton>
          </form>
        </Modal>
      ) : null}
      {viewing ? (
        <Modal title="推送详情" size="wide" onClose={() => setViewing(null)}>
          <div className="bd-push-detail text-sm">
            <article className="bd-push-hero">
              <div className="bd-push-hero-meta">
                <span>💌 家庭推送</span>
                <span>{viewing.deliveries.length ? "已发布" : "草稿"}</span>
              </div>
              <p className="bd-push-hero-body">{viewing.body || "仅链接推送"}</p>
              {viewing.linkUrl ? <VideoLinkPreview url={viewing.linkUrl} /> : null}
              {detailPush?.media.length ? (
                <div className="bd-push-content-media">
                  <h3>推送附件</h3>
                  <MediaPreviewList
                    studentId={detailPush.studentId}
                    media={detailPush.media}
                    testIdPrefix={`push-content-media-${viewing.id}`}
                  />
                </div>
              ) : null}
              <p className="relative z-10 text-slate-600">
                {viewing.tags.length ? viewing.tags.map((tag) => `#${tag}`).join(" ") : "无标签"} ·
                已投递给 {viewing.deliveries.length} 名学生
                {viewing.answerDisclosureDays === null
                  ? " · 作答立即公开"
                  : ` · ${viewing.answerDisclosureDays} 天后公开`}
              </p>
            </article>
            {viewing.deliveries.length ? (
              <div className="grid gap-3 lg:grid-cols-2" aria-label="学生作答与评论">
                {viewing.deliveries.map((delivery) => {
                  const student = students.find((item) => item.studentId === delivery.studentId);
                  return (
                    <PushDeliveryThread
                      key={delivery.pushId}
                      studentId={delivery.studentId}
                      pushId={delivery.pushId}
                      studentName={student?.displayName || student?.username || "未命名学生"}
                      onError={reportError}
                    />
                  );
                })}
              </div>
            ) : null}
            <div className="sticky bottom-0 flex justify-end gap-2 rounded-2xl border border-[var(--bd-border)] bg-white/95 p-3 shadow-lg backdrop-blur">
              <SecondaryButton onClick={() => setViewing(null)}>关闭</SecondaryButton>
              <PrimaryButton
                type="button"
                fullWidth={false}
                onClick={() => {
                  setViewing(null);
                  openEditPush(viewing);
                }}
              >
                编辑推送
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      ) : null}
      {addingRecipients ? (
        <Modal
          title="添加接收学生"
          onClose={() => {
            setAddingRecipients(null);
            setAdditionalRecipientIds([]);
            setAdditionalImageFiles([]);
          }}
        >
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">
              已接收的学生不会自动重复发送；请选择需要追加的学生。
            </p>
            <StudentMultiSelect
              students={students.filter(
                (student) =>
                  !addingRecipients.deliveries.some(
                    (delivery) => delivery.studentId === student.studentId,
                  ),
              )}
              selectedIds={additionalRecipientIds}
              onChange={setAdditionalRecipientIds}
              emptyLabel="选择要追加的学生"
            />
            <Field label="图片（可选，0–5 张；需要随本次追加重新上传）">
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => chooseImages(event.target.files, setAdditionalImageFiles)}
              />
              {additionalImageFiles.length ? (
                <span className="text-xs text-slate-500">
                  已选择 {additionalImageFiles.length} 张
                </span>
              ) : null}
            </Field>
            <PrimaryButton
              type="button"
              disabled={saving || !additionalRecipientIds.length}
              onClick={() => void addRecipients()}
            >
              {saving ? "追加中…" : "确认添加学生"}
            </PrimaryButton>
          </div>
        </Modal>
      ) : null}
    </PageShell>
  );
}

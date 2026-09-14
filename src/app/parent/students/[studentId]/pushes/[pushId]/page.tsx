import { redirect } from "next/navigation";

export default async function ParentStudentPushDetailRedirect({ params }: { params: Promise<{ studentId: string; pushId: string }> }) {
  const { studentId, pushId } = await params;
  redirect(`/parent/pushes?studentId=${encodeURIComponent(studentId)}&pushId=${encodeURIComponent(pushId)}`);
}

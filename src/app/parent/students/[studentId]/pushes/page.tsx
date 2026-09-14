import { redirect } from "next/navigation";

export default async function ParentStudentPushesRedirect({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  redirect(`/parent/pushes?studentId=${encodeURIComponent(studentId)}`);
}

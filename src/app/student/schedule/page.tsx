import { redirect } from "next/navigation";

export default function StudentScheduleCompatibilityPage() {
  redirect("/student/plans?view=schedule");
}

import { cookies } from "next/headers";

import { DELETION_CAPABILITY_COOKIE } from "@/modules/data-lifecycle/deletion-capability.service";

export async function readDeletionCapabilityCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(DELETION_CAPABILITY_COOKIE)?.value ?? null;
}

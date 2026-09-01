import { createMemoryArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";

export const exportRouteArtifactStore = createMemoryArtifactStore();
export const deletionRouteArtifactStore = createMemoryArtifactStore();

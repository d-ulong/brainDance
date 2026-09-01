import {
  createConfiguredFilesystemArtifactStore,
  type PrivateArtifactStore,
} from "@/modules/data-lifecycle/private-artifact-store";

let cachedExportStore: PrivateArtifactStore | null = null;
let cachedDeletionStore: PrivateArtifactStore | null = null;

function sharedPersistentStore(): PrivateArtifactStore {
  // App routes and the independent worker must share the same configured root.
  return createConfiguredFilesystemArtifactStore();
}

export function getExportRouteArtifactStore(): PrivateArtifactStore {
  cachedExportStore ??= sharedPersistentStore();
  return cachedExportStore;
}

export function getDeletionRouteArtifactStore(): PrivateArtifactStore {
  // Deletion and export share one private root so purge/revoke stays consistent.
  cachedDeletionStore ??= sharedPersistentStore();
  return cachedDeletionStore;
}

/** @deprecated Use getExportRouteArtifactStore() — kept as lazy getter alias for imports. */
export const exportRouteArtifactStore: PrivateArtifactStore = new Proxy(
  {} as PrivateArtifactStore,
  {
    get(_target, prop, receiver) {
      const store = getExportRouteArtifactStore();
      const value = Reflect.get(store, prop, receiver);
      return typeof value === "function" ? value.bind(store) : value;
    },
  },
);

/** @deprecated Use getDeletionRouteArtifactStore() — kept as lazy getter alias for imports. */
export const deletionRouteArtifactStore: PrivateArtifactStore = new Proxy(
  {} as PrivateArtifactStore,
  {
    get(_target, prop, receiver) {
      const store = getDeletionRouteArtifactStore();
      const value = Reflect.get(store, prop, receiver);
      return typeof value === "function" ? value.bind(store) : value;
    },
  },
);

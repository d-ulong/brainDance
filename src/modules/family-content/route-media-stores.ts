import { getSharedSqlClient } from "@/db";
import {
  createPostgresMediaUploadIdempotencyLock,
  type MediaUploadIdempotencyLock,
} from "@/modules/family-content/media-upload-idempotency-lock";
import {
  createConfiguredFilesystemMediaStore,
  createMemoryMediaStore,
  type PrivateMediaStore,
} from "@/modules/family-content/private-media-store";
import { resolveMediaScanner, type MediaScanner } from "@/modules/family-content/media-scanner";

let cachedStore: PrivateMediaStore | null = null;
let cachedScanner: MediaScanner | null = null;
let cachedUploadLock: MediaUploadIdempotencyLock | null = null;
let testStoreOverride: PrivateMediaStore | null = null;
let testScannerOverride: MediaScanner | null = null;
let testUploadLockOverride: MediaUploadIdempotencyLock | null = null;

export function setRouteMediaStoreForTest(store: PrivateMediaStore | null): void {
  testStoreOverride = store;
  cachedStore = null;
}

export function setRouteMediaScannerForTest(scanner: MediaScanner | null): void {
  testScannerOverride = scanner;
  cachedScanner = null;
}

export function getRouteMediaStore(): PrivateMediaStore {
  if (testStoreOverride) {
    return testStoreOverride;
  }
  if (process.env.NODE_ENV === "test" && !process.env.BRAIN_DANCE_MEDIA_ROOT) {
    cachedStore ??= createMemoryMediaStore();
    return cachedStore;
  }
  cachedStore ??= createConfiguredFilesystemMediaStore();
  return cachedStore;
}

export function getRouteMediaScanner(): MediaScanner {
  if (testScannerOverride) {
    return testScannerOverride;
  }
  cachedScanner ??= resolveMediaScanner();
  return cachedScanner;
}

export function setRouteMediaUploadIdempotencyLockForTest(
  lock: MediaUploadIdempotencyLock | null,
): void {
  testUploadLockOverride = lock;
  cachedUploadLock = null;
}

/** Production lock bound to the shared `getDb()` postgres authority. */
export function getRouteMediaUploadIdempotencyLock(): MediaUploadIdempotencyLock {
  if (testUploadLockOverride) {
    return testUploadLockOverride;
  }
  cachedUploadLock ??= createPostgresMediaUploadIdempotencyLock(getSharedSqlClient());
  return cachedUploadLock;
}

export const routeMediaStore: PrivateMediaStore = new Proxy({} as PrivateMediaStore, {
  get(_target, prop, receiver) {
    const store = getRouteMediaStore();
    const value = Reflect.get(store, prop, receiver);
    return typeof value === "function" ? value.bind(store) : value;
  },
});

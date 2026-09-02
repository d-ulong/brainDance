export type MediaScanResult =
  | { outcome: "clean" }
  | { outcome: "rejected"; category: string }
  | { outcome: "error"; category: string };

export type MediaScanner = {
  scan(bytes: Buffer, declaredMime: string): Promise<MediaScanResult>;
};

/** TEST ONLY — never use as a production default. */
export function createAlwaysCleanTestScanner(): MediaScanner {
  return {
    async scan() {
      return { outcome: "clean" };
    },
  };
}

export function createFailClosedProductionScanner(): MediaScanner {
  return {
    async scan() {
      return { outcome: "error", category: "scanner_not_configured" };
    },
  };
}

export function resolveMediaScanner(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): MediaScanner {
  const scannerMode = env.BRAIN_DANCE_MEDIA_SCANNER?.trim();
  const allowTestScanner =
    env.NODE_ENV !== "production" || env.BRAIN_DANCE_ALLOW_TEST_MEDIA_SCANNER === "true";
  if (scannerMode === "test-clean" && allowTestScanner) {
    return createAlwaysCleanTestScanner();
  }
  return createFailClosedProductionScanner();
}

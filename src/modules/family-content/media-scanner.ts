export type MediaScanResult =
  | { outcome: "clean" }
  | { outcome: "skipped"; category: "local_pilot_no_scan" }
  | { outcome: "rejected"; category: string }
  | { outcome: "error"; category: string };

export type MediaScanner = {
  scan(bytes: Buffer, declaredMime: string): Promise<MediaScanResult>;
};

export function isLocalMediaScanSkipped(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (
    env.BRAIN_DANCE_MEDIA_SCANNER?.trim() !== "local-no-scan" ||
    env.LOCAL_PILOT_MODE !== "true" ||
    env.NODE_ENV === "production"
  )
    return false;
  try {
    const url = new URL(env.NEXT_PUBLIC_APP_URL ?? "");
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isMediaScanAccepted(
  scanResult: string | null,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return scanResult === "clean" || (scanResult === "skipped" && isLocalMediaScanSkipped(env));
}

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
  if (scannerMode === "local-no-scan") {
    if (isLocalMediaScanSkipped(env)) {
      return {
        async scan() {
          return { outcome: "skipped", category: "local_pilot_no_scan" };
        },
      };
    }
    return createFailClosedProductionScanner();
  }
  const allowTestScanner = env.NODE_ENV !== "production";
  if (scannerMode === "test-clean" && allowTestScanner) {
    return createAlwaysCleanTestScanner();
  }
  if (
    scannerMode === "https-relay" &&
    env.BRAIN_DANCE_MEDIA_SCANNER_URL &&
    env.BRAIN_DANCE_MEDIA_SCANNER_TOKEN
  ) {
    try {
      const url = new URL(env.BRAIN_DANCE_MEDIA_SCANNER_URL);
      if (url.protocol !== "https:") return createFailClosedProductionScanner();
      return {
        async scan(bytes, declaredMime) {
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                authorization: `Bearer ${env.BRAIN_DANCE_MEDIA_SCANNER_TOKEN}`,
                "content-type": declaredMime,
              },
              body: new Uint8Array(bytes),
              signal: AbortSignal.timeout(10_000),
              redirect: "error",
            });
            if (!response.ok) return { outcome: "error", category: "scanner_unavailable" };
            const result: unknown = await response.json();
            if (result && typeof result === "object" && "outcome" in result) {
              if (result.outcome === "clean") return { outcome: "clean" };
              if (result.outcome === "rejected")
                return { outcome: "rejected", category: "scanner_rejected" };
            }
            return { outcome: "error", category: "scanner_invalid_response" };
          } catch {
            return { outcome: "error", category: "scanner_unavailable" };
          }
        },
      };
    } catch {
      return createFailClosedProductionScanner();
    }
  }
  return createFailClosedProductionScanner();
}

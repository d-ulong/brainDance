import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("applies defaults for minimal env", () => {
    const env = parseEnv({
      NODE_ENV: "test",
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.SKIP_DB_TESTS).toBe(false);
  });

  it("parses SKIP_DB_TESTS flag", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      SKIP_DB_TESTS: "true",
    });

    expect(env.SKIP_DB_TESTS).toBe(true);
  });
});

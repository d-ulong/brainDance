import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.BRAIN_DANCE_ARTIFACT_ROOT ??= `${process.cwd().replace(/\\/g, "/")}/.braindance-artifacts/vitest`;

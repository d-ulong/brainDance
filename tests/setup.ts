import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";

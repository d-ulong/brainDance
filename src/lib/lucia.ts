import { DrizzlePostgreSQLAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";

import type { Database } from "@/db";
import { sessions, users } from "@/db/schema";

declare module "lucia" {
  interface Register {
    Lucia: ReturnType<typeof createLucia>;
    DatabaseUserAttributes: {
      role: "admin" | "parent" | "student";
      authorizationEpoch: number;
    };
    DatabaseSessionAttributes: {
      authorizationEpoch: number;
    };
  }
}

function sessionCookieSecure(): boolean {
  if (process.env.SESSION_COOKIE_SECURE === "false") {
    return false;
  }
  if (process.env.SESSION_COOKIE_SECURE === "true") {
    return true;
  }
  return process.env.NODE_ENV === "production";
}

export function createLucia(db: Database) {
  const adapter = new DrizzlePostgreSQLAdapter(db, sessions, users);

  return new Lucia(adapter, {
    sessionCookie: {
      name: "braindance_session",
      expires: false,
      attributes: {
        secure: sessionCookieSecure(),
        sameSite: "lax",
        path: "/",
      },
    },
    getUserAttributes: (attributes) => ({
      role: attributes.role,
      authorizationEpoch: attributes.authorizationEpoch,
    }),
    getSessionAttributes: (attributes) => ({
      authorizationEpoch: attributes.authorizationEpoch,
    }),
  });
}

export type AppLucia = ReturnType<typeof createLucia>;

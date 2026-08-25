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

export function createLucia(db: Database) {
  const adapter = new DrizzlePostgreSQLAdapter(db, sessions, users);

  return new Lucia(adapter, {
    sessionCookie: {
      name: "braindance_session",
      expires: false,
      attributes: {
        secure: process.env.NODE_ENV === "production",
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

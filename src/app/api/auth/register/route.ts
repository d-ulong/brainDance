import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { jsonWithSessionCookie } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { login } from "@/modules/identity/login.service";
import { PRODUCT_PASSWORD_MAX_LENGTH } from "@/modules/identity/password-policy";
import { registerParent, registerStudent } from "@/modules/identity/registration.service";

const bodySchema = z
  .object({
    role: z.enum(["parent", "student"]).default("parent"),
    invitationCode: z.string().min(8).max(128),
    displayName: z.string().trim().min(1).max(64),
    username: z.string().trim().min(3).max(64).optional(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    email: z.string().email().optional(),
    phone: z.string().min(6).max(32).optional(),
    password: z.string().min(1).max(PRODUCT_PASSWORD_MAX_LENGTH),
    idempotencyKey: z.string().min(8).max(128),
  })
  .refine(
    (value) =>
      value.role === "student"
        ? Boolean(value.username && value.birthDate)
        : Boolean(value.email) !== Boolean(value.phone),
    {
      message: "家长须填写联系方式；学生须填写用户名和出生日期",
    },
  );

export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = bodySchema.parse(await request.json());

    const shared = {
      invitationCode: body.invitationCode,
      displayName: body.displayName,
      password: body.password,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    };
    const result =
      body.role === "student"
        ? await registerStudent(db, {
            ...shared,
            username: body.username!,
            birthDate: body.birthDate!,
          })
        : await registerParent(db, { ...shared, email: body.email, phone: body.phone });

    const identifier = result.contactValue;
    const session = await login(db, {
      identifier,
      password: body.password,
      idempotencyKey: `register-login:${body.idempotencyKey}`,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    const [dbUser] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);

    return jsonWithSessionCookie(
      {
        userId: result.userId,
        status: dbUser?.status ?? result.status,
        contactType: result.contactType,
        contactVerified: body.role === "student" || Boolean(dbUser?.contactVerifiedAt),
        idempotentReplay: result.idempotentReplay,
      },
      session.sessionCookie,
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "请检查姓名、账号、生日和邀请码是否填写完整", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}

import { IdentityError } from "@/modules/identity/errors";

export function mayExposeDevOtpPlaintext(env = process.env): boolean {
  return env.NODE_ENV !== "production";
}

export function verificationDeliveryConfigured(env = process.env): boolean {
  try {
    const endpoint = new URL(env.VERIFICATION_DELIVERY_URL ?? "");
    return endpoint.protocol === "https:" && Boolean(env.VERIFICATION_DELIVERY_TOKEN);
  } catch {
    return false;
  }
}

/** Relay receives private contact/code over HTTPS; it must never log the payload. */
export async function deliverVerificationCode(input: {
  verificationId: string;
  contactType: string;
  contactValue: string;
  code: string;
  expiresAt: Date;
}): Promise<"sent" | "development"> {
  if (!verificationDeliveryConfigured()) {
    if (mayExposeDevOtpPlaintext()) return "development";
    throw new IdentityError("DELIVERY_UNAVAILABLE", "验证码发送服务暂不可用，请稍后重试");
  }
  try {
    const response = await fetch(process.env.VERIFICATION_DELIVERY_URL!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.VERIFICATION_DELIVERY_TOKEN}`,
        "idempotency-key": input.verificationId,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Delivery rejected");
    return "sent";
  } catch {
    throw new IdentityError("DELIVERY_UNAVAILABLE", "验证码发送失败，请稍后重新获取");
  }
}

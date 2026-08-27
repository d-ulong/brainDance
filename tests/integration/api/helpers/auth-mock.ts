import { vi } from "vitest";

const cookieStore = {
  value: null as string | null,
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === "braindance_session" && cookieStore.value) {
        return { name, value: cookieStore.value };
      }
      return undefined;
    },
  })),
}));

export function setMockSessionCookie(value: string | null) {
  cookieStore.value = value;
}

export function clearMockSessionCookie() {
  cookieStore.value = null;
}

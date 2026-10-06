import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_COOKIE = "edge_admin";
export const SESSION_SECONDS = 12 * 60 * 60;

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Sessions are signed with a key derived from the password, so changing
// ADMIN_PASSWORD signs everyone out.
function sign(value: string): string {
  const key = createHmac("sha256", process.env.ADMIN_PASSWORD ?? "").update("edge-admin-session").digest();
  return createHmac("sha256", key).update(value).digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const expires = String(now + SESSION_SECONDS * 1000);
  return `${expires}.${sign(expires)}`;
}

export function sessionValid(token: string | undefined, now = Date.now()): boolean {
  if (!token || !adminConfigured()) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || Number(expires) < now) return false;
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function isAdmin(): Promise<boolean> {
  return sessionValid((await cookies()).get(ADMIN_COOKIE)?.value);
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

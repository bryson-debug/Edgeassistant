import { ADMIN_COOKIE, adminConfigured, createSessionToken, passwordMatches, SESSION_SECONDS } from "@/lib/admin-auth";
import { checkLoginLimit, visitorKey } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cookieBase = `Path=/admin; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

function redirectTo(path: string, cookie?: string) {
  const headers = new Headers({ Location: path });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

// Sign in (action=login) or out (action=logout) from the admin forms.
export async function POST(request: Request) {
  if (!isSameOrigin(request.headers)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const action = form?.get("action");

  if (action === "logout") {
    return redirectTo("/admin/login", `${ADMIN_COOKIE}=; Max-Age=0; ${cookieBase}`);
  }
  if (!adminConfigured()) return redirectTo("/admin/login");
  if (!(await checkLoginLimit(visitorKey(request.headers)))) {
    return redirectTo("/admin/login?error=limit");
  }
  const password = form?.get("password");
  if (typeof password !== "string" || !passwordMatches(password)) {
    return redirectTo("/admin/login?error=1");
  }
  return redirectTo("/admin", `${ADMIN_COOKIE}=${createSessionToken()}; Max-Age=${SESSION_SECONDS}; ${cookieBase}`);
}

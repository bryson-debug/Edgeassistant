import { NextResponse, type NextRequest } from "next/server";
import { getAllowedParentOrigins } from "@/lib/config";

// Only the member site may embed the assistant. With no origins configured,
// framing is blocked everywhere. The admin pages can never be framed.
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/admin")) {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Referrer-Policy", "same-origin");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const origins = getAllowedParentOrigins();
  response.headers.set("Content-Security-Policy", `frame-ancestors ${origins.length ? origins.join(" ") : "'none'"}`);
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

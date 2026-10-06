import { NextResponse } from "next/server";
import { getAllowedParentOrigins } from "@/lib/config";

// Only the member site may embed the assistant. With no origins configured,
// framing is blocked everywhere.
export function proxy() {
  const origins = getAllowedParentOrigins();
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", `frame-ancestors ${origins.length ? origins.join(" ") : "'none'"}`);
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect("/admin");
  const { error } = await searchParams;
  const configured = adminConfigured();
  return (
    <main className="login">
      <h1>Assistant Admin</h1>
      {!configured ? (
        <p className="note">
          Admin is turned off. Add an <code>ADMIN_PASSWORD</code> environment variable in Vercel and redeploy to turn it on.
        </p>
      ) : (
        <form method="post" action="/admin/session">
          <input type="hidden" name="action" value="login" />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
          {error && (
            <p className="form-error" role="alert">
              {error === "limit" ? "Too many attempts. Try again in an hour." : "That password didn't work."}
            </p>
          )}
          <button type="submit" className="btn primary">
            Sign in
          </button>
        </form>
      )}
    </main>
  );
}

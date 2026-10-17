import type { Env } from "../env";
import { nowIso, uid } from "../env";
import { saveDryRun } from "../dryrun";
import { html, json, redirect } from "../util";
import type { AuthProvider } from "./types";
import { createSession, sessionCookieHeader, upsertUserByEmail } from "./session";

export const magicLinkAuth: AuthProvider = {
  name: "magic_link",
  async begin(env, request) {
    if (request.method === "GET") {
      return html(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Sign in — PriceMoved</title>
<style>body{font-family:system-ui;max-width:420px;margin:48px auto;padding:0 16px;background:#0b1020;color:#e8ecf7}
input,button{width:100%;padding:10px;margin:8px 0;border-radius:8px;border:1px solid #243049;background:#141a2f;color:#e8ecf7}
button{background:#6ee7b7;color:#062016;font-weight:700;border:0;cursor:pointer}</style></head>
<body><h1>Sign in</h1>
<p style="color:#9aa3b8">Magic-link sign-in (local dry-run: link is shown here / written to dry-run artifacts, not emailed).</p>
<form method="POST" action="/auth/magic/start"><label>Email</label>
<input type="email" name="email" required placeholder="you@example.com"/>
<button type="submit">Get sign-in link</button></form>
<p style="color:#9aa3b8;font-size:.9rem"><a href="/auth/google" style="color:#6ee7b7">Google OAuth</a> (stub)</p>
<p style="color:#9aa3b8;font-size:.85rem"><a href="/privacy" style="color:#6ee7b7">Privacy</a> · <a href="/terms" style="color:#6ee7b7">Terms</a></p>
<p><a href="/" style="color:#9aa3b8">← Home</a></p></body></html>`);
    }
    let email = "";
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      email = (((await request.json()) as { email?: string }).email || "").trim().toLowerCase();
    } else {
      email = String((await request.formData()).get("email") || "").trim().toLowerCase();
    }
    if (!email.includes("@")) return json({ error: "valid email required" }, 400);
    const token = uid("ml");
    const expires = new Date(Date.now() + 15 * 60_000).toISOString();
    await env.DB.prepare(
      "INSERT INTO magic_links (token, email, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)"
    )
      .bind(token, email, expires, nowIso())
      .run();
    const link = `${env.BASE_URL}/auth/magic/callback?token=${token}`;
    await saveDryRun(env, "magic-links", { email, link, token, created_at: nowIso() }, token);
    if (ct.includes("json") || (request.headers.get("accept") || "").includes("json")) {
      return json({ ok: true, dry_run: true, message: "Magic link dry-run (not emailed).", link, token });
    }
    return html(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Magic link</title>
<style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:0 16px;background:#0b1020;color:#e8ecf7}
a{color:#6ee7b7;word-break:break-all}</style></head>
<body><h1>Magic link ready (dry-run)</h1><p>No email sent. Open:</p><p><a href="${link}">${link}</a></p></body></html>`);
  },
  async complete(env, request) {
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!token) return json({ error: "token required" }, 400);
    const row = await env.DB.prepare(
      "SELECT * FROM magic_links WHERE token = ? AND used = 0 AND expires_at > ?"
    )
      .bind(token, nowIso())
      .first<{ email: string }>();
    if (!row) return json({ error: "invalid or expired magic link" }, 400);
    await env.DB.prepare("UPDATE magic_links SET used = 1 WHERE token = ?").bind(token).run();
    const user = await upsertUserByEmail(env, row.email);
    const session = await createSession(env, user.id);
    return redirect("/app", 302, { "Set-Cookie": sessionCookieHeader(session) });
  },
};

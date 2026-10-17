import type { Env } from "../env";
import { isDevEnvironment, nowIso, uid } from "../env";
import { html, json } from "../util";
import { landingHtmlForEnv } from "../landing/render";
import { resolveWaitlistSource } from "../waitlist-source";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT = 5; // per IP hash per hour

export function landingPage(env: Env): Response {
  return html(landingHtmlForEnv(env));
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const dig = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown"
  );
}

async function ensureWaitlistRateTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS waitlist_rate (
      ip_hash TEXT NOT NULL,
      window_id TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ip_hash, window_id)
    )`
  ).run();
}

async function rateLimited(env: Env, request: Request): Promise<boolean> {
  await ensureWaitlistRateTable(env);
  const secret = env.SESSION_SECRET || "local-dev";
  const ipHash = await sha256Hex(`${secret}:wl:${clientIp(request)}`);
  const windowId = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH UTC hour
  const row = await env.DB.prepare(
    "SELECT hit_count AS c FROM waitlist_rate WHERE ip_hash = ? AND window_id = ?"
  )
    .bind(ipHash, windowId)
    .first<{ c: number }>();
  const count = row?.c ?? 0;
  if (count >= RATE_LIMIT) return true;
  await env.DB.prepare(
    `INSERT INTO waitlist_rate (ip_hash, window_id, hit_count, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(ip_hash, window_id) DO UPDATE SET hit_count = hit_count + 1, updated_at = excluded.updated_at`
  )
    .bind(ipHash, windowId, nowIso())
    .run();
  const cutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString().slice(0, 13);
  await env.DB.prepare("DELETE FROM waitlist_rate WHERE window_id < ?").bind(cutoff).run();
  return false;
}

function wantsJson(request: Request, ct: string): boolean {
  return ct.includes("json") || (request.headers.get("accept") || "").includes("json");
}

export async function handleWaitlist(env: Env, request: Request): Promise<Response> {
  let email = "";
  let honeypot = "";
  let bodySrc: unknown = "";
  const ct = request.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const body = (await request.json()) as { email?: string; website?: string; src?: unknown };
    email = (body.email || "").trim().toLowerCase();
    honeypot = (body.website || "").trim();
    bodySrc = body.src ?? "";
  } else {
    const form = await request.formData();
    email = String(form.get("email") || "").trim().toLowerCase();
    honeypot = String(form.get("website") || "").trim();
    bodySrc = String(form.get("src") ?? "");
  }

  if (honeypot) {
    if (wantsJson(request, ct)) return json({ ok: true, email: email || "ok" });
    return successHtml(email || "ok");
  }

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    if (wantsJson(request, ct)) return json({ error: "valid email required" }, 400);
    return html(
      `<!DOCTYPE html><html><body style="font-family:system-ui;background:#0b1020;color:#e8ecf7;padding:48px">
<h1>Invalid email</h1><p><a href="/#waitlist" style="color:#6ee7b7">Try again</a></p></body></html>`,
      400
    );
  }

  if (!env.SESSION_SECRET && !isDevEnvironment(env)) {
    // Never hash IPs with a known salt in production.
    return json({ error: "temporarily_unavailable" }, 503);
  }

  if (await rateLimited(env, request)) {
    if (wantsJson(request, ct)) {
      return json({ error: "rate_limited", message: "Too many attempts. Try again later." }, 429);
    }
    return html(
      `<!DOCTYPE html><html><body style="font-family:system-ui;background:#0b1020;color:#e8ecf7;padding:48px">
<h1>Too many attempts</h1><p>Please try again in an hour.</p><p><a href="/" style="color:#6ee7b7">Home</a></p></body></html>`,
      429
    );
  }

  const existing = await env.DB.prepare("SELECT email FROM waitlist WHERE email = ?")
    .bind(email)
    .first<{ email: string }>();

  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO waitlist (id, email, created_at, source) VALUES (?, ?, ?, ?)"
    )
      .bind(uid("wl"), email, nowIso(), resolveWaitlistSource(bodySrc, request))
      .run();
  }

  if (wantsJson(request, ct)) {
    return json({ ok: true, email, already: Boolean(existing) });
  }
  return successHtml(email, Boolean(existing));
}

function successHtml(email: string, already = false): Response {
  const msg = already
    ? `You're already on the list (${email}).`
    : `You're on the list (${email}). We'll be in touch — no confirmation email is sent yet.`;
  return html(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#0b1020;color:#e8ecf7;padding:48px">
<h1>You are on the list</h1><p>${msg}</p>
<p><a href="/privacy" style="color:#6ee7b7">Privacy</a> · <a href="/" style="color:#6ee7b7">Home</a></p>
</body></html>`);
}

import type { Env, PlanId } from "../env";
import { nowIso, uid } from "../env";
import { clearCookie, cookie, parseCookies } from "../util";
import type { User } from "./types";

const SESSION_COOKIE = "pw_session";
const SESSION_DAYS = 30;

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = uid("sess");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(token, userId, expires, nowIso())
    .run();
  return token;
}

export function sessionCookieHeader(token: string): string {
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

export function clearSessionCookieHeader(): string {
  return clearCookie(SESSION_COOKIE);
}

export async function getUserFromRequest(env: Env, request: Request): Promise<User | null> {
  const token = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE];
  if (!token) return null;
  return (
    (await env.DB.prepare(
      `SELECT u.id, u.email, u.google_sub, u.plan, u.polar_customer_id, u.slack_webhook_url, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
      .bind(token, nowIso())
      .first<User>()) ?? null
  );
}

export async function upsertUserByEmail(
  env: Env,
  email: string,
  googleSub: string | null = null
): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(normalized)
    .first<User>();
  if (existing) {
    if (googleSub && !existing.google_sub) {
      await env.DB.prepare("UPDATE users SET google_sub = ? WHERE id = ?")
        .bind(googleSub, existing.id)
        .run();
      return { ...existing, google_sub: googleSub };
    }
    return existing;
  }
  const user: User = {
    id: uid("usr"),
    email: normalized,
    google_sub: googleSub,
    plan: "free",
    polar_customer_id: null,
    slack_webhook_url: null,
    created_at: nowIso(),
  };
  await env.DB.prepare(
    `INSERT INTO users (id, email, google_sub, plan, polar_customer_id, slack_webhook_url, created_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?)`
  )
    .bind(user.id, user.email, user.google_sub, user.plan, user.created_at)
    .run();
  return user;
}

export async function setUserPlan(env: Env, userId: string, plan: PlanId): Promise<void> {
  await env.DB.prepare("UPDATE users SET plan = ? WHERE id = ?").bind(plan, userId).run();
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const token = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

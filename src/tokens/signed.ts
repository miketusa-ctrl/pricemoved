import type { Env } from "../env";
import { hmacSha256Hex } from "../util";

async function sign(secret: string, payload: string): Promise<string> {
  return hmacSha256Hex(secret, payload);
}

export async function makeActionToken(
  env: Env,
  action: "mute" | "unsubscribe",
  opts: { userId: string; watchId?: string; expSec?: number }
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + (opts.expSec ?? 60 * 60 * 24 * 30);
  const body = [action, opts.userId, opts.watchId || "", String(exp)].join("|");
  const sig = await sign(env.SESSION_SECRET, body);
  return btoa(`${body}|${sig}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifyActionToken(
  env: Env,
  token: string
): Promise<{ action: "mute" | "unsubscribe"; userId: string; watchId: string; exp: number } | null> {
  try {
    const pad = "=".repeat((4 - (token.length % 4)) % 4);
    const raw = atob(token.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const parts = raw.split("|");
    if (parts.length !== 5) return null;
    const [action, userId, watchId, expStr, sig] = parts;
    if (action !== "mute" && action !== "unsubscribe") return null;
    const body = [action, userId, watchId, expStr].join("|");
    const expected = await sign(env.SESSION_SECRET, body);
    if (expected !== sig) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
    return { action, userId, watchId, exp };
  } catch {
    return null;
  }
}

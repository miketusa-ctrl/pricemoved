import type { Env } from "../env";
import { html, json } from "../util";
import { verifyActionToken } from "../tokens/signed";

export async function handleMuteAction(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const parsed = await verifyActionToken(env, token);
  if (!parsed || parsed.action !== "mute" || !parsed.watchId) {
    return html("<h1>Invalid or expired mute link</h1>", 400);
  }
  await env.DB.prepare("UPDATE watches SET muted = 1 WHERE id = ? AND user_id = ?")
    .bind(parsed.watchId, parsed.userId)
    .run();
  if (url.searchParams.get("one_click") === "1" || request.method === "POST") {
    return json({ ok: true, muted: true });
  }
  return html(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#0b1020;color:#e8ecf7;padding:48px">
<h1>Watch muted</h1><p>We won’t alert on this watch until you unmute it in the dashboard.</p>
<p><a href="/app" style="color:#6ee7b7">Open dashboard</a></p></body></html>`);
}

export async function handleUnsubscribeAction(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const parsed = await verifyActionToken(env, token);
  if (!parsed || parsed.action !== "unsubscribe") {
    return html("<h1>Invalid or expired unsubscribe link</h1>", 400);
  }
  // Mute all watches for user (alerts off)
  await env.DB.prepare("UPDATE watches SET muted = 1 WHERE user_id = ?").bind(parsed.userId).run();
  if (url.searchParams.get("one_click") === "1" || request.method === "POST") {
    return json({ ok: true, unsubscribed: true });
  }
  return html(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#0b1020;color:#e8ecf7;padding:48px">
<h1>Unsubscribed</h1><p>All watches are muted. You can re-enable them anytime in the dashboard.</p>
<p><a href="/app" style="color:#6ee7b7">Open dashboard</a> · <a href="/privacy" style="color:#6ee7b7">Privacy</a></p></body></html>`);
}
